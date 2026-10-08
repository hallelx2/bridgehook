import {
	CHANNEL_EXPIRY_HOURS,
	MAX_BODY_SIZE_BYTES,
	MAX_BUFFERED_EVENTS,
	PLANS,
	type PlanId,
	TRIAL_DAYS,
} from "@bridgehook/shared";
import { events, channels, user as userTable } from "@bridgehook/shared/db/schema";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { checkChannelCreate, checkDailyEventCap, loadUserAccess } from "./access.js";
import { createAuth, getAvailableAuthProviders, getSessionUser } from "./auth.js";
import { createPolarClient } from "./billing.js";
import { type DB, getDb } from "./db.js";
import { getOrCreateSelfHostUser, resolveCaller, touchDevice } from "./identity.js";
import { handleMcpRequest } from "./mcp.js";
import { originPolicy } from "./origin-policy.js";
import { buildAuthDeviceRoutes, cleanupExpiredDeviceCodes } from "./routes/auth-device.js";
import { buildBillingRoutes } from "./routes/billing.js";
import { buildMeDevicesRoutes } from "./routes/me-devices.js";
import { buildMeRoutes } from "./routes/me.js";
import {
	SYNC_TIMEOUT_DEFAULT_MS,
	type SyncOutcome,
	clampSyncTimeout,
	isResponseMode,
	syncResponse,
} from "./sync.js";
import {
	CHANNEL_ID_RE,
	WEBHOOK_METHODS,
	buildWebhookUrl,
	classifyHost,
	isPathAllowed,
	isWebhookMethod,
	parseChannelPath,
	stripOwnCookies,
} from "./webhook-url.js";

export { ChannelDO } from "./channel-do.js";
export { UserDO } from "./user-do.js";

export interface Env {
	/** Cloudflare D1: users, auth, channels, events, devices, billing. */
	DB: D1Database;
	CHANNEL: DurableObjectNamespace;
	/** Per-user fan-out DO; absent in self-host mode (no auth = no concept of "me"). */
	USER: DurableObjectNamespace;
	/** Optional: KV namespace for rate-limit counters. Falls back to no-op if absent. */
	RATE_LIMIT?: KVNamespace;
	/** Auth — when unset, relay runs in self-host mode (no auth, no /auth/** routes). */
	BETTER_AUTH_SECRET?: string;
	BETTER_AUTH_URL?: string;
	AUTH_COOKIE_DOMAIN?: string;
	AUTH_TRUSTED_ORIGINS?: string;
	RESEND_API_KEY?: string;
	MAIL_FROM?: string;
	/** Web app base URL — used to build verificationUrl in the device-pairing flow. */
	WEB_URL?: string;
	/** Self-host: auto-attach all channels to this user id (or auto-created self-host user). */
	SELF_HOST_USER_ID?: string;
	/**
	 * Apex for channel hosts, e.g. "bridgehook.dev": webhooks to
	 * `<channelId>.<TUNNEL_DOMAIN>` are intake, and channel webhook URLs are
	 * shown in that form. Needs a proxied wildcard DNS record and a Worker
	 * route `*.<TUNNEL_DOMAIN>/*`. Unset (self-host without wildcard DNS):
	 * URLs use the path form on the relay host.
	 */
	TUNNEL_DOMAIN?: string;
	/** Polar billing — when unset, /api/me/billing/* returns 503 and webhooks 404. */
	POLAR_ACCESS_TOKEN?: string;
	POLAR_WEBHOOK_SECRET?: string;
	POLAR_PRODUCT_ID_HOBBY?: string;
	POLAR_PRODUCT_ID_PRO?: string;
	POLAR_PRODUCT_ID_TEAM?: string;
}

// ── Version ───────────────────────────────────────────────────────────────
const RELAY_VERSION = "0.1.0";

// ── Limits ─────────────────────────────────────────────────────────────────
const CHANNEL_ID_LEN = 12;
const EVENT_ID_LEN = 16;
const MAX_HEADERS_BYTES = 32 * 1024;
const MAX_ALLOWED_PATHS = 20;
const MAX_ALLOWED_PATH_LEN = 256;
const DEFAULT_EVENT_LIMIT = 50;
/** ECDSA P-256 raw public key: 1 tag byte + 32 X + 32 Y = 65 bytes → 130 hex chars. */
const PUBLIC_KEY_HEX_LEN = 130;
/** ECDSA P-256 signature (r || s): 64 bytes → 128 hex chars. */
const SIGNATURE_HEX_LEN = 128;
/** Acceptable clock skew for signed requests. */
const SIGNATURE_MAX_SKEW_MS = 60_000;
/** What a webhook URL says when opened in a browser. */
const CHANNEL_URL_MESSAGE =
	"This is a BridgeHook webhook URL. Point your provider at it; requests are queued and forwarded to your local server by the BridgeHook extension or dashboard, including any that arrive while your browser is closed.";
/** An unanswered claim older than this can be taken over by another executor. */
const CLAIM_STALE_MS = 60_000;

// ── Rate limit ────────────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_SEC = 60;
const RATE_LIMIT_MAX_PER_IP = 10;

// ── Helpers ───────────────────────────────────────────────────────────────
function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

async function safeReadJson<T>(request: Request): Promise<T | null> {
	try {
		return (await request.json()) as T;
	} catch {
		return null;
	}
}

function toHex(bytes: Uint8Array | ArrayBuffer): string {
	const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let out = "";
	for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
	return out;
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
	if (hex.length % 2 !== 0) throw new Error("Invalid hex length");
	const buf = new ArrayBuffer(hex.length / 2);
	const out = new Uint8Array(buf);
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
	}
	return out;
}

async function sha256Hex(input: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return toHex(buf);
}

const utf8 = new TextEncoder();

/** Encoded size in bytes; `.length` counts UTF-16 code units and undercounts. */
function byteLength(s: string): number {
	return utf8.encode(s).byteLength;
}

function isHex(s: string, len?: number): boolean {
	if (len !== undefined && s.length !== len) return false;
	return /^[0-9a-f]+$/i.test(s);
}

function getChannelDO(env: Env, channelId: string) {
	const id = env.CHANNEL.idFromName(channelId);
	return env.CHANNEL.get(id);
}

function getUserDO(env: Env, userId: string) {
	const id = env.USER.idFromName(userId);
	return env.USER.get(id);
}

/**
 * Best-effort fan-out to a user's UserDO. Failures are logged and swallowed
 * — the SSE push is a UX nicety, never load-bearing.
 */
function notifyUserDO(env: Env, userId: string | null, payload: string): void {
	if (!userId) return;
	const stub = getUserDO(env, userId);
	stub
		.fetch(new Request("https://do/notify", { method: "POST", body: payload }))
		.catch((err) => console.error("UserDO notify failed:", err));
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Webhook intake — the single canonical path for accepting an inbound webhook,
 * shared by `/<channelId>[/path]` and the `/hook/<channelId>` alias (see
 * ./webhook-url.ts). Validates, persists the event row, fans out via both the
 * channel DO (per-channel SSE) and the user DO (cross-channel dashboard), and
 * returns 202 immediately. Never awaits localhost — the executor's response
 * lands later via `POST /hook/:channelId/response` and updates the row
 * out-of-band.
 *
 * `events.path` is stored post-prefix (plus any query string) so it reads as
 * the path localhost receives, whichever URL form the producer used.
 */
async function handleWebhookIntake(
	channelId: string,
	forwardPath: string,
	request: Request,
	env: Env,
): Promise<Response> {
	if (!CHANNEL_ID_RE.test(channelId)) {
		return jsonResponse(404, { error: "Channel not found" });
	}
	const db = getDb(env);

	const claimed = Number(request.headers.get("content-length") || "0");
	if (claimed > MAX_BODY_SIZE_BYTES) {
		return jsonResponse(413, { error: "Body too large" });
	}

	const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
	if (!channel) return jsonResponse(404, { error: "Channel not found" });

	const url = new URL(request.url);
	const method = request.method.toUpperCase();
	const sync = channel.responseMode === "sync";
	const isRead = method === "GET" || method === "HEAD";
	if (!isWebhookMethod(method) && !isRead) {
		return new Response(JSON.stringify({ error: "Method not allowed" }), {
			status: 405,
			headers: { "Content-Type": "application/json", Allow: acceptedMethods(sync).join(", ") },
		});
	}
	// With channel hosts available, sync replies (content from the owner's
	// server) are only ever served on <id>.<TUNNEL_DOMAIN>, never on the relay
	// host that carries the API and the session cookie.
	if (
		sync &&
		env.TUNNEL_DOMAIN &&
		classifyHost(request.headers.get("host"), env.TUNNEL_DOMAIN).kind !== "channel"
	) {
		return jsonResponse(421, {
			error: "Sync channels answer on their own host",
			webhookUrl: buildWebhookUrl(channel.id, url, env.TUNNEL_DOMAIN),
		});
	}
	// Async channels answer a browser (or a curious GET) with what the URL
	// is; sync channels forward GET/HEAD so verification handshakes work.
	if (isRead && !sync) {
		return jsonResponse(200, {
			channelId: channel.id,
			webhookUrl: buildWebhookUrl(channel.id, url, env.TUNNEL_DOMAIN),
			responseMode: "async",
			accepts: acceptedMethods(false),
			message: CHANNEL_URL_MESSAGE,
		});
	}
	// The query string travels with the path so providers that sign or route
	// on it (`?token=…`) reach localhost intact. Allow-list matching is on the
	// path alone.
	const cleanPath = `${forwardPath}${url.search}`;

	const allowedPaths = safeJsonParse<string[]>(channel.allowedPaths, []);
	if (!isPathAllowed(forwardPath, allowedPaths)) {
		return jsonResponse(403, { error: "Path not allowed for this channel" });
	}

	// Daily event cap (free-tier rate limit). Owned channels only — anonymous
	// channels and self-host (Infinity cap) short-circuit through the access
	// layer with no KV cost. The cap check increments the KV counter on
	// success, so this is the only place the counter advances.
	if (channel.userId) {
		const access = await loadUserAccess(db, channel.userId);
		if (access && Number.isFinite(access.limits.eventsPerDay)) {
			const capCheck = await checkDailyEventCap(env.RATE_LIMIT, access);
			if (!capCheck.ok) {
				return jsonResponse(capCheck.status, {
					error: capCheck.error,
					code: "quota",
				});
			}
		}
	}

	const headers: Record<string, string> = {};
	let headersBytes = 0;
	request.headers.forEach((value, key) => {
		headersBytes += byteLength(key) + byteLength(value) + 4;
		if (key === "cookie") {
			const kept = stripOwnCookies(value);
			if (kept) headers[key] = kept;
			return;
		}
		headers[key] = value;
	});
	if (headersBytes > MAX_HEADERS_BYTES) {
		return jsonResponse(431, { error: "Headers too large" });
	}

	const body = await request.text();
	if (byteLength(body) > MAX_BODY_SIZE_BYTES) {
		return jsonResponse(413, { error: "Body too large" });
	}

	const eventId = crypto.randomUUID().replace(/-/g, "").slice(0, EVENT_ID_LEN);
	const [evt] = await db
		.insert(events)
		.values({
			id: eventId,
			channelId,
			method: request.method,
			path: cleanPath,
			requestHeaders: JSON.stringify(headers),
			requestBody: body || null,
		})
		.returning();

	const ssePayload = JSON.stringify({
		type: "webhook",
		id: evt.id,
		channelId,
		method: evt.method,
		path: evt.path,
		headers,
		body,
		receivedAt: evt.receivedAt.toISOString(),
	});

	const stub = getChannelDO(env, channelId);
	// Sync: register the wait before waking executors, so even an instant
	// answer finds its waiter (the DO also keeps early answers briefly).
	const waiting = sync
		? stub.fetch(
				new Request("https://do/wait", {
					method: "POST",
					body: JSON.stringify({
						eventId: evt.id,
						timeoutMs: channel.syncTimeoutMs ?? SYNC_TIMEOUT_DEFAULT_MS,
					}),
				}),
			)
		: null;
	stub
		.fetch(new Request("https://do/notify", { method: "POST", body: ssePayload }))
		.catch((err) => console.error("DO notify failed:", err));

	// Cross-channel dashboard fan-out: only when the channel has an owner.
	notifyUserDO(env, channel.userId, ssePayload);

	if (waiting) {
		let outcome: SyncOutcome = { kind: "timeout" };
		try {
			outcome = (await (await waiting).json()) as SyncOutcome;
		} catch (err) {
			console.error("Sync wait failed:", err);
		}
		return syncResponse(outcome, evt.id, method);
	}

	return jsonResponse(202, { received: true, eventId: evt.id, channelId });
}

/** Methods a channel URL accepts in each response mode. */
function acceptedMethods(sync: boolean): string[] {
	return sync ? [...WEBHOOK_METHODS, "GET", "HEAD"] : [...WEBHOOK_METHODS];
}

function validateAllowedPaths(input: unknown): string[] | null {
	if (!Array.isArray(input)) return null;
	if (input.length > MAX_ALLOWED_PATHS) return null;
	const out: string[] = [];
	for (const p of input) {
		if (typeof p !== "string") return null;
		const trimmed = p.trim();
		if (!trimmed.startsWith("/")) return null;
		if (trimmed.length === 0 || trimmed.length > MAX_ALLOWED_PATH_LEN) return null;
		out.push(trimmed);
	}
	return out;
}

interface PendingCursor {
	receivedAt: Date;
	id: string;
}

function parsePendingCursor(raw: string | null): PendingCursor | null {
	if (!raw) return null;
	try {
		const json = JSON.parse(atob(raw)) as { ts?: unknown; id?: unknown };
		if (typeof json.ts !== "string" || typeof json.id !== "string") return null;
		if (!/^[a-z0-9]{1,32}$/.test(json.id)) return null;
		const d = new Date(json.ts);
		return Number.isNaN(d.getTime()) ? null : { receivedAt: d, id: json.id };
	} catch {
		return null;
	}
}

function buildPendingCursor(receivedAt: Date, id: string): string {
	return btoa(JSON.stringify({ ts: receivedAt.toISOString(), id }));
}

function parseLimit(raw: string | null): number {
	const n = Number.parseInt(raw ?? "", 10);
	if (!Number.isFinite(n) || n <= 0) return DEFAULT_EVENT_LIMIT;
	return Math.min(n, MAX_BUFFERED_EVENTS);
}

// ── Rate limiting (KV-backed) ─────────────────────────────────────────────
async function checkRateLimit(env: Env, request: Request, key: string): Promise<boolean> {
	if (!env.RATE_LIMIT) return true;
	const ip =
		request.headers.get("CF-Connecting-IP") ||
		request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
		"unknown";
	const bucket = `rl:${key}:${ip}`;

	try {
		const current = await env.RATE_LIMIT.get(bucket);
		const count = current ? Number.parseInt(current, 10) : 0;
		if (count >= RATE_LIMIT_MAX_PER_IP) return false;
		await env.RATE_LIMIT.put(bucket, String(count + 1), {
			expirationTtl: RATE_LIMIT_WINDOW_SEC,
		});
		return true;
	} catch (err) {
		console.error("Rate limit KV error:", err);
		return true;
	}
}

// ── Authentication ────────────────────────────────────────────────────────
// All channels authenticate via ECDSA P-256 signatures. The legacy bearer
// (secret_hash) scheme was retired in migration 0008.

async function verifyAndReadBody(
	request: Request,
	publicKeyHex: string,
): Promise<{ ok: true; body: string } | { ok: false; status: number; error: string }> {
	return verifyEcdsa(request, publicKeyHex);
}

async function verifyEcdsa(
	request: Request,
	publicKeyHex: string,
): Promise<{ ok: true; body: string } | { ok: false; status: number; error: string }> {
	const timestamp = request.headers.get("X-BH-Timestamp");
	const signatureHex = request.headers.get("X-BH-Signature");

	if (!timestamp || !signatureHex) {
		return { ok: false, status: 401, error: "Missing signature" };
	}
	if (!isHex(signatureHex, SIGNATURE_HEX_LEN)) {
		return { ok: false, status: 401, error: "Invalid signature format" };
	}

	const ts = Number(timestamp);
	if (!Number.isFinite(ts)) {
		return { ok: false, status: 401, error: "Invalid timestamp" };
	}
	if (Math.abs(Date.now() - ts) > SIGNATURE_MAX_SKEW_MS) {
		return { ok: false, status: 401, error: "Timestamp outside window" };
	}

	if (!isHex(publicKeyHex, PUBLIC_KEY_HEX_LEN)) {
		return { ok: false, status: 500, error: "Channel misconfigured" };
	}

	const body = await request.text();

	let publicKey: CryptoKey;
	try {
		publicKey = await crypto.subtle.importKey(
			"raw",
			fromHex(publicKeyHex),
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["verify"],
		);
	} catch {
		return { ok: false, status: 500, error: "Channel misconfigured" };
	}

	const url = new URL(request.url);
	const canonical = `${request.method.toUpperCase()}\n${url.pathname}\n${timestamp}\n${await sha256Hex(body)}`;

	let verified = false;
	try {
		verified = await crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			publicKey,
			fromHex(signatureHex),
			new TextEncoder().encode(canonical),
		);
	} catch {
		verified = false;
	}

	if (!verified) {
		return { ok: false, status: 401, error: "Invalid signature" };
	}

	return { ok: true, body };
}

// ── Hono app ──────────────────────────────────────────────────────────────
type AppEnv = { Bindings: Env };
const app = new Hono<AppEnv>();

// Cross-origin policy: credentialed CORS only for trusted origins, and
// session-cookie mutations refused from anywhere else. See ./origin-policy.ts.
app.use("*", originPolicy());

app.onError((err, c) => {
	console.error("Relay error:", err);
	return c.json({ error: "Internal Server Error" }, 500);
});

// ── Device pairing routes ─────────────────────────────────────────────────
// Mounted before the catch-all /auth/* below so they take precedence.
app.route(
	"/auth/device",
	buildAuthDeviceRoutes((c) => {
		const env = (c as { env: Env }).env;
		const auth = createAuth(env);
		if (!auth || !env.WEB_URL) return null;
		return { auth, db: getDb(env), webUrl: env.WEB_URL };
	}),
);

// ── /api/me/devices ────────────────────────────────────────────────────────
app.route(
	"/api/me/devices",
	buildMeDevicesRoutes((c) => {
		const env = (c as { env: Env }).env;
		const auth = createAuth(env);
		if (!auth) return null;
		return { auth, db: getDb(env) };
	}),
);

// ── /api/me/* (account read endpoints + channel management + replay) ────
app.route(
	"/api/me",
	buildMeRoutes((c) => {
		const env = (c as { env: Env }).env;
		const auth = createAuth(env);
		if (!auth) return null;
		return {
			auth,
			db: getDb(env),
			notifier: {
				getChannelDO: (channelId: string) => getChannelDO(env, channelId),
				notifyUser: (userId: string | null, payload: string) => notifyUserDO(env, userId, payload),
			},
			tunnelDomain: env.TUNNEL_DOMAIN ?? null,
		};
	}),
);

// ── /api/me/stream (cross-channel SSE) ─────────────────────────────────
// Long-lived SSE, authed by session or device token. Pushes every webhook / response / claim
// event for any channel owned by the current user. Heartbeats every 20s
// inside the UserDO so intermediaries don't kill the connection.
//
// Self-host mode (no auth) returns 404. The dashboard's per-channel
// polling stays as a fallback when this stream is unavailable.
app.get("/api/me/stream", async (c) => {
	const auth = createAuth(c.env);
	if (!auth) return c.json({ error: "Auth not configured" }, 404);

	// Session or device token: a paired extension streams with no dashboard
	// session.
	const caller = await resolveCaller(auth, getDb(c.env), c.req.raw);
	if (!caller) return c.json({ error: "Not signed in" }, 401);

	const stub = getUserDO(c.env, caller.userId);
	// Forward the request to the DO, preserving the abort signal so the
	// DO's `request.signal.addEventListener("abort", ...)` cleanup fires
	// when the client disconnects.
	return stub.fetch(
		new Request("https://do/stream", {
			method: "GET",
			signal: c.req.raw.signal,
		}),
	);
});

// ── /api/me/billing/* and /api/billing/webhook ──────────────────────────
// The router mounts at /api so the billing module owns both /me/billing/*
// (session-authed) and /billing/webhook (signature-verified) under one tree.
app.route(
	"/api",
	buildBillingRoutes((c) => {
		const env = (c as { env: Env }).env;
		const auth = createAuth(env);
		const polar = createPolarClient(env);
		if (!auth || !polar || !env.WEB_URL) return null;
		return {
			auth,
			db: getDb(env),
			polar,
			webhookSecret: env.POLAR_WEBHOOK_SECRET,
			webUrl: env.WEB_URL,
		};
	}),
);

// ── Better-Auth catch-all mount ───────────────────────────────────────────
// Mounted only when BETTER_AUTH_SECRET is set. Self-hosters who haven't
// configured auth get 404s on /auth/** routes — the web client probes
// /api/config first to know whether to render auth UI.
app.all("/auth/*", async (c) => {
	const auth = createAuth(c.env);
	if (!auth) return c.json({ error: "Auth not configured" }, 404);
	return auth.handler(c.req.raw);
});

// ── MCP server for AI coding agents ──
// Stateless Streamable HTTP at /mcp. Auth: agent token (Bearer dvc_…) from
// the dashboard's AI agents page, any device token, or the session.
app.all("/mcp", async (c) => {
	const env = c.env;
	const db = getDb(env);
	const auth = createAuth(env);
	let userId: string;
	let deviceId: string | null = null;
	if (auth) {
		const caller = await resolveCaller(auth, db, c.req.raw, { allowAgentTokens: true });
		if (!caller) {
			return c.json(
				{
					error:
						"BridgeHook MCP needs an agent token: create one at https://app.bridgehook.dev/dashboard/agents and send it as Authorization: Bearer <token>.",
				},
				401,
				{ "WWW-Authenticate": 'Bearer realm="BridgeHook"' },
			);
		}
		userId = caller.userId;
		deviceId = caller.deviceId;
		if (deviceId) await touchDevice(db, deviceId);
	} else {
		userId = await getOrCreateSelfHostUser(db, env);
	}
	return handleMcpRequest(c.req.raw, {
		db,
		userId,
		deviceId,
		requestUrl: new URL(c.req.url),
		tunnelDomain: env.TUNNEL_DOMAIN,
		notifier: {
			getChannelDO: (channelId: string) => getChannelDO(env, channelId),
			notifyUser: (uid: string | null, payload: string) => notifyUserDO(env, uid, payload),
		},
		deliver: (channelId: string, forwardPath: string, request: Request) =>
			handleWebhookIntake(channelId, forwardPath, request, env),
	});
});

// ── Health ──
app.get("/health", (c) => c.json({ status: "ok" }));

// ── Config probe (public, unauthenticated) ──
// Web/extension call this once at startup to gate UI affordances:
//   - `authEnabled`: hosted-mode flag (false = self-host, no auth UI at all)
//   - `billingEnabled`: Polar is configured; Billing page shows checkout
//   - `authProviders`: which sign-in buttons Login should render (google,
//     github, magicLink). Each is independently optional — the Login page
//     hides buttons whose providers aren't configured here.
app.get("/api/config", (c) => {
	const authEnabled = Boolean(c.env.BETTER_AUTH_SECRET);
	const billingEnabled = authEnabled && Boolean(c.env.POLAR_ACCESS_TOKEN);
	const authProviders = authEnabled
		? getAvailableAuthProviders(c.env)
		: { emailPassword: false, google: false, github: false, magicLink: false };
	return c.json({
		authEnabled,
		signupEnabled: authEnabled,
		billingEnabled,
		authProviders,
		trialDays: TRIAL_DAYS,
		version: RELAY_VERSION,
	});
});

// ── Create channel ──
// In hosted mode (BETTER_AUTH_SECRET set), requires either a Better-Auth
// session cookie OR a device-token Bearer header. Anonymous creates return
// 401. ECDSA P-256 is the only supported channel auth scheme.
//
// In self-host mode (BETTER_AUTH_SECRET unset), all creates resolve to the
// implicit SELF_HOST_USER_ID user (or auto-created self-host@local).
app.post("/api/channels", async (c) => {
	const env = c.env;
	const db = getDb(env);
	const auth = createAuth(env);

	if (!(await checkRateLimit(env, c.req.raw, "create"))) {
		return c.json({ error: "Rate limit exceeded" }, 429);
	}

	// Resolve caller identity. In self-host mode, always succeeds with the
	// implicit user. In hosted mode, returns 401 when no auth is provided.
	let userId: string;
	let deviceId: string | null = null;
	if (auth) {
		const caller = await resolveCaller(auth, db, c.req.raw);
		if (!caller) {
			return c.json(
				{
					error: "Authentication required. Sign in with the web app or pair a device first.",
				},
				401,
			);
		}
		userId = caller.userId;
		deviceId = caller.deviceId;
		if (deviceId) await touchDevice(db, deviceId);

		// Plan / quota gate. Self-host (no auth branch) skips this entirely
		// because the implicit user carries the `selfhost` tier.
		const access = await loadUserAccess(db, userId);
		if (!access) return c.json({ error: "User not found" }, 404);
		const gate = await checkChannelCreate(db, access);
		if (!gate.ok) return c.json({ error: gate.error, code: "quota" }, gate.status);
	} else {
		userId = await getOrCreateSelfHostUser(db, env);
	}

	const body = await safeReadJson<{
		publicKey?: unknown;
		port?: unknown;
		allowedPaths?: unknown;
		label?: unknown;
		responseMode?: unknown;
		syncTimeoutMs?: unknown;
	}>(c.req.raw);

	if (!body) return c.json({ error: "Invalid JSON body" }, 400);

	if (typeof body.publicKey !== "string" || body.publicKey.length === 0) {
		return c.json({ error: "publicKey is required (130-char ECDSA P-256 hex)" }, 400);
	}
	if (!isHex(body.publicKey, PUBLIC_KEY_HEX_LEN)) {
		return c.json({ error: "publicKey must be a 130-char hex string" }, 400);
	}
	try {
		await crypto.subtle.importKey(
			"raw",
			fromHex(body.publicKey),
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["verify"],
		);
	} catch {
		return c.json({ error: "publicKey is not a valid ECDSA P-256 point" }, 400);
	}
	const publicKey = body.publicKey;

	if (
		typeof body.port !== "number" ||
		!Number.isInteger(body.port) ||
		body.port < 1 ||
		body.port > 65535
	) {
		return c.json({ error: "port must be an integer 1-65535" }, 400);
	}

	const allowedPaths = validateAllowedPaths(body.allowedPaths ?? []);
	if (allowedPaths === null) {
		return c.json({ error: "allowedPaths must be an array of path strings starting with /" }, 400);
	}

	const label =
		typeof body.label === "string" && body.label.trim().length > 0
			? body.label.trim().slice(0, 64)
			: null;

	if (body.responseMode !== undefined && !isResponseMode(body.responseMode)) {
		return c.json({ error: "responseMode must be 'async' or 'sync'" }, 400);
	}
	const responseMode = body.responseMode ?? "async";
	const syncTimeoutMs =
		body.syncTimeoutMs === undefined
			? SYNC_TIMEOUT_DEFAULT_MS
			: clampSyncTimeout(body.syncTimeoutMs);
	if (syncTimeoutMs === null) return c.json({ error: "syncTimeoutMs must be a number" }, 400);

	const channelId = crypto.randomUUID().replace(/-/g, "").slice(0, CHANNEL_ID_LEN);
	// Owned channels are perpetual; events are aged out by retention cron, not channel.
	const expiresAt: Date | null = null;

	const [channel] = await db
		.insert(channels)
		.values({
			id: channelId,
			publicKey,
			port: body.port,
			allowedPaths: JSON.stringify(allowedPaths),
			userId,
			deviceId,
			label,
			expiresAt,
			responseMode,
			syncTimeoutMs,
		})
		.returning();

	const url = new URL(c.req.url);
	return c.json(
		{
			channelId: channel.id,
			port: channel.port,
			label: channel.label,
			userId: channel.userId,
			deviceId: channel.deviceId,
			expiresAt: channel.expiresAt?.toISOString() ?? null,
			webhookUrl: buildWebhookUrl(channel.id, url, c.env.TUNNEL_DOMAIN),
			responseMode: channel.responseMode,
			syncTimeoutMs: channel.syncTimeoutMs,
			authScheme: "ecdsa",
		},
		201,
	);
});

// ── Channel info (public) ──
app.get("/api/channels/:channelId", async (c) => {
	const channelId = c.req.param("channelId");
	if (!/^[a-z0-9]{1,24}$/.test(channelId)) {
		return c.json({ error: "Channel not found" }, 404);
	}
	const db = getDb(c.env);

	const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);

	if (!channel) return c.json({ error: "Channel not found" }, 404);

	const url = new URL(c.req.url);
	return c.json({
		id: channel.id,
		port: channel.port,
		allowedPaths: safeJsonParse<string[]>(channel.allowedPaths, []),
		createdAt: channel.createdAt.toISOString(),
		expiresAt: channel.expiresAt?.toISOString() ?? null,
		webhookUrl: buildWebhookUrl(channel.id, url, c.env.TUNNEL_DOMAIN),
		responseMode: channel.responseMode,
		syncTimeoutMs: channel.syncTimeoutMs,
		authScheme: "ecdsa",
	});
});

// ── Channel delete (ECDSA OR session+owner) ──
// Plugs the recovery hole: a signed-in user can nuke a channel they own
// even if the channel's IDB private key is gone (different browser profile,
// IDB cleared, etc.).
app.delete("/api/channels/:channelId", async (c) => {
	const channelId = c.req.param("channelId");
	if (!/^[a-z0-9]{1,24}$/.test(channelId)) {
		return c.json({ error: "Channel not found" }, 404);
	}
	const db = getDb(c.env);

	const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
	if (!channel) return c.json({ error: "Channel not found" }, 404);

	// Allow session-authenticated owner to delete without ECDSA (recovery path).
	const auth = createAuth(c.env);
	if (auth && channel.userId) {
		const sessionUser = await getSessionUser(auth, c.req.raw);
		if (sessionUser && sessionUser.id === channel.userId) {
			await db.delete(channels).where(eq(channels.id, channelId));
			return c.json({ deleted: true, via: "session" });
		}
	}

	// Otherwise require an ECDSA-signed delete request.
	const verified = await verifyAndReadBody(c.req.raw, channel.publicKey);
	if (!verified.ok) return c.json({ error: verified.error }, verified.status as 401 | 500);

	await db.delete(channels).where(eq(channels.id, channelId));
	return c.json({ deleted: true });
});

// ── List events (auth) ──
app.get("/api/channels/:channelId/events", async (c) => {
	const channelId = c.req.param("channelId");
	if (!/^[a-z0-9]{1,24}$/.test(channelId)) {
		return c.json({ error: "Channel not found" }, 404);
	}
	const db = getDb(c.env);

	const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
	if (!channel) return c.json({ error: "Channel not found" }, 404);

	const verified = await verifyAndReadBody(c.req.raw, channel.publicKey);
	if (!verified.ok) return c.json({ error: verified.error }, verified.status as 401 | 500);

	const limit = parseLimit(c.req.query("limit") ?? null);

	// `?pending=1` is the delivery queue: events no executor has answered yet,
	// oldest first, paged by an opaque cursor. An executor that starts after
	// the browser was closed drains this in order before going live, so
	// nothing that arrived offline is skipped or reordered.
	if (c.req.query("pending") === "1") {
		// received_at is integer milliseconds, the same precision as the
		// cursor, so ordering and comparison round-trip exactly.
		const receivedMs = events.receivedAt;
		const cursor = parsePendingCursor(c.req.query("after") ?? null);
		const conditions = [
			eq(events.channelId, channelId),
			isNull(events.responseStatus),
			isNull(events.error),
		];
		if (cursor) {
			conditions.push(
				or(
					gt(receivedMs, cursor.receivedAt),
					and(eq(receivedMs, cursor.receivedAt), gt(events.id, cursor.id)),
				)!,
			);
		}
		const rows = await db
			.select()
			.from(events)
			.where(and(...conditions))
			.orderBy(asc(receivedMs), asc(events.id))
			.limit(limit + 1);
		const hasMore = rows.length > limit;
		const page = hasMore ? rows.slice(0, limit) : rows;
		const last = page[page.length - 1];
		return c.json({
			events: page,
			nextCursor: hasMore && last ? buildPendingCursor(last.receivedAt, last.id) : null,
		});
	}

	const rows = await db
		.select()
		.from(events)
		.where(eq(events.channelId, channelId))
		.orderBy(desc(events.receivedAt))
		.limit(limit);

	return c.json(rows);
});

// ── Receive webhook: `/hook/<channelId>` alias (back-compat) ──
// The canonical `/<channelId>[/path]` form is registered last, after every
// first-party route, so it can never shadow one. See ./webhook-url.ts.
app.on([...WEBHOOK_METHODS, "GET", "HEAD"], "/hook/:channelId", async (c) => {
	return handleWebhookIntake(c.req.param("channelId"), "/", c.req.raw, c.env);
});

// ── Claim event for executor (auth) ──
// Multi-device arbitration: when several executors are connected to the
// same channel (extension + dashboard tab + paired desktop), they race to
// forward each event. The first one to call /claim wins via an atomic
// UPDATE … WHERE claimed_by_device_id IS NULL; the losers see 409 and
// drop the work. The DO is also notified so any SSE subscriber gets a
// `{ type: "claimed", eventId, claimerId }` push and can update the UI
// without waiting for the response round-trip.
app.post("/hook/:channelId/claim", async (c) => {
	const channelId = c.req.param("channelId");
	if (!/^[a-z0-9]{1,24}$/.test(channelId)) {
		return c.json({ error: "Channel not found" }, 404);
	}
	const db = getDb(c.env);

	const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
	if (!channel) return c.json({ error: "Channel not found" }, 404);

	const verified = await verifyAndReadBody(c.req.raw, channel.publicKey);
	if (!verified.ok) return c.json({ error: verified.error }, verified.status as 401 | 500);

	let raw: unknown;
	try {
		raw = JSON.parse(verified.body);
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const parsed = (raw ?? {}) as { eventId?: unknown; clientId?: unknown };

	if (typeof parsed.eventId !== "string" || !/^[a-z0-9]{1,32}$/.test(parsed.eventId)) {
		return c.json({ error: "Invalid eventId" }, 400);
	}
	if (
		typeof parsed.clientId !== "string" ||
		parsed.clientId.length < 1 ||
		parsed.clientId.length > 64
	) {
		return c.json({ error: "Invalid clientId (1-64 chars)" }, 400);
	}
	const eventId = parsed.eventId;
	const clientId = parsed.clientId;

	// Atomic claim: the row flips when nobody holds it, when the caller already
	// holds it, or when the holder claimed it more than CLAIM_STALE_MS ago and
	// never answered (a tab closed
	// or a browser quit mid-forward). Without that expiry such an event would
	// sit in the queue forever. Composite WHERE also pins to this channel so a
	// poisoned eventId from one channel can't claim another's event.
	const claimedAt = new Date();
	const staleBefore = new Date(claimedAt.getTime() - CLAIM_STALE_MS);
	const claimed = await db
		.update(events)
		.set({ claimedByDeviceId: clientId, claimedAt })
		.where(
			and(
				eq(events.id, eventId),
				eq(events.channelId, channelId),
				isNull(events.responseStatus),
				or(
					isNull(events.claimedByDeviceId),
					// Re-claim by the holder refreshes the timestamp, so an executor
					// retrying while localhost is down keeps its claim alive.
					eq(events.claimedByDeviceId, clientId),
					lt(events.claimedAt, staleBefore),
				),
			),
		)
		.returning({ id: events.id });

	if (claimed.length > 0) {
		// Wake other listeners so the UI can stop spinning on this event.
		const payload = JSON.stringify({
			type: "claimed",
			eventId,
			channelId,
			claimerId: clientId,
			claimedAt: claimedAt.toISOString(),
		});
		const stub = getChannelDO(c.env, channelId);
		stub
			.fetch(new Request("https://do/notify", { method: "POST", body: payload }))
			.catch((err) => console.error("DO notify (claim) failed:", err));
		notifyUserDO(c.env, channel.userId, payload);
		return c.json({ claimed: true, claimerId: clientId, claimedAt: claimedAt.toISOString() });
	}

	// Lost the race — surface the actual winner so the client can render it.
	const [existing] = await db
		.select({
			claimerId: events.claimedByDeviceId,
			claimedAt: events.claimedAt,
		})
		.from(events)
		.where(and(eq(events.id, eventId), eq(events.channelId, channelId)))
		.limit(1);
	if (!existing) {
		return c.json({ error: "Event not found" }, 404);
	}
	return c.json(
		{
			claimed: false,
			claimerId: existing.claimerId,
			claimedAt: existing.claimedAt?.toISOString() ?? null,
		},
		409,
	);
});

// ── Receive response from client (auth) ──
app.post("/hook/:channelId/response", async (c) => {
	const channelId = c.req.param("channelId");
	if (!/^[a-z0-9]{1,24}$/.test(channelId)) {
		return c.json({ error: "Channel not found" }, 404);
	}
	const db = getDb(c.env);

	const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
	if (!channel) return c.json({ error: "Channel not found" }, 404);

	const verified = await verifyAndReadBody(c.req.raw, channel.publicKey);
	if (!verified.ok) return c.json({ error: verified.error }, verified.status as 401 | 500);

	let raw: unknown;
	try {
		raw = JSON.parse(verified.body);
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const parsed = raw as {
		eventId?: unknown;
		status?: unknown;
		headers?: unknown;
		body?: unknown;
		latencyMs?: unknown;
	};

	if (typeof parsed.eventId !== "string" || !/^[a-z0-9]{1,32}$/.test(parsed.eventId)) {
		return c.json({ error: "Invalid eventId" }, 400);
	}
	if (
		typeof parsed.status !== "number" ||
		!Number.isInteger(parsed.status) ||
		parsed.status < 0 ||
		parsed.status >= 1000
	) {
		return c.json({ error: "Invalid status" }, 400);
	}

	const respHeaders: Record<string, string> = {};
	let respHeadersBytes = 0;
	if (parsed.headers && typeof parsed.headers === "object" && !Array.isArray(parsed.headers)) {
		for (const [k, v] of Object.entries(parsed.headers as Record<string, unknown>)) {
			if (typeof v !== "string") continue;
			respHeadersBytes += byteLength(k) + byteLength(v) + 4;
			respHeaders[k] = v;
		}
	}
	if (respHeadersBytes > MAX_HEADERS_BYTES) {
		return c.json({ error: "Headers too large" }, 431);
	}
	const respBody = typeof parsed.body === "string" ? parsed.body : "";
	if (byteLength(respBody) > MAX_BODY_SIZE_BYTES) {
		return c.json({ error: "Body too large" }, 413);
	}
	const latencyMs =
		typeof parsed.latencyMs === "number" && Number.isFinite(parsed.latencyMs)
			? Math.max(0, Math.round(parsed.latencyMs))
			: 0;

	// Pin to this channel: the signature proves control of the channel in the
	// URL, not of an arbitrary event id.
	const updated = await db
		.update(events)
		.set({
			responseStatus: parsed.status,
			responseHeaders: JSON.stringify(respHeaders),
			responseBody: respBody,
			latencyMs,
		})
		.where(and(eq(events.id, parsed.eventId), eq(events.channelId, channelId)))
		.returning({ id: events.id });
	if (updated.length === 0) return c.json({ error: "Event not found" }, 404);

	const summary = {
		type: "response",
		eventId: parsed.eventId,
		channelId,
		status: parsed.status,
		latencyMs,
	};
	const responsePayload = JSON.stringify(summary);
	// The channel DO always gets the whole reply: a sync sender may be waiting
	// even if the channel was switched to async meanwhile, and the DO simply
	// drops it when nobody is. Awaited, so the sender is answered before the
	// executor's POST returns.
	const doPayload = JSON.stringify({
		...summary,
		sync: { status: parsed.status, headers: respHeaders, body: respBody, latencyMs },
	});

	const stub = getChannelDO(c.env, channelId);
	await stub
		.fetch(new Request("https://do/notify", { method: "POST", body: doPayload }))
		.catch((err) => console.error("DO notify failed:", err));
	notifyUserDO(c.env, channel.userId, responsePayload);

	return c.json({ ok: true });
});

// ── Receive webhook: canonical `/<channelId>[/path]` ──
// Registered after every first-party route. Anything after the id is the
// path forwarded to localhost. GET answers with a short description so a
// URL pasted into a browser explains itself instead of 404ing.
app.all("*", async (c, next) => {
	const parsed = parseChannelPath(c.req.path);
	if (!parsed) return next();
	const m = c.req.method.toUpperCase();
	if (isWebhookMethod(m) || m === "GET" || m === "HEAD") {
		return handleWebhookIntake(parsed.channelId, parsed.forwardPath, c.req.raw, c.env);
	}
	return c.json({ error: "Method not allowed" }, 405, {
		Allow: [...WEBHOOK_METHODS, "GET"].join(", "),
	});
});

// ── Catch-all 404 ──
app.notFound((c) => c.json({ error: "Not Found" }, 404));

/**
 * Per-plan event retention sweep. Deletes events older than the plan's
 * `retentionDays` for users on that plan. Skipped in self-host mode (no
 * BETTER_AUTH_SECRET) — the implicit selfhost user has unlimited retention
 * anyway, and self-hosters typically prefer to manage their own DB hygiene.
 */
async function retentionSweep(db: DB): Promise<void> {
	for (const planId of ["trialing", "hobby", "pro", "team"] as PlanId[]) {
		const retention = PLANS[planId].limits.retentionDays;
		if (!Number.isFinite(retention) || retention <= 0) continue;
		const cutoff = new Date(Date.now() - retention * 86_400_000);

		// Channels owned by users on this plan, as a subquery: D1 caps bound
		// parameters at 100, so the id list must never be inlined.
		const planChannels = db
			.select({ id: channels.id })
			.from(channels)
			.innerJoin(userTable, eq(channels.userId, userTable.id))
			.where(eq(userTable.plan, planId));

		const deleted = await db
			.delete(events)
			.where(and(inArray(events.channelId, planChannels), lt(events.receivedAt, cutoff)))
			.returning({ id: events.id });

		if (deleted.length > 0) {
			console.log(
				`Retention sweep [${planId}]: deleted ${deleted.length} events older than ${retention}d`,
			);
		}
	}
}

/**
 * A request to `<channelId>.<TUNNEL_DOMAIN>`: webhook intake only. The API,
 * auth and the executor endpoints are not reachable on channel hosts, and no
 * response carries credentials.
 */
async function handleChannelHost(channelId: string, request: Request, env: Env): Promise<Response> {
	let res: Response;
	try {
		res = await channelHostResponse(channelId, request, env);
	} catch (err) {
		// Outside Hono, so app.onError never sees this; answer the same way.
		console.error("Channel host error:", err);
		res = jsonResponse(500, { error: "Internal Server Error" });
	}
	// Browser senders (the dashboard's test button, any page posting a test
	// webhook) need to read the answer. Never with credentials.
	const out = new Response(res.body, res);
	if (!out.headers.has("access-control-allow-origin")) {
		out.headers.set("Access-Control-Allow-Origin", "*");
	}
	return out;
}

async function channelHostResponse(
	channelId: string,
	request: Request,
	env: Env,
): Promise<Response> {
	const url = new URL(request.url);
	const method = request.method.toUpperCase();
	if (isWebhookMethod(method) || method === "GET" || method === "HEAD") {
		return handleWebhookIntake(channelId, url.pathname || "/", request, env);
	}
	if (method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": [...WEBHOOK_METHODS, "GET", "HEAD", "OPTIONS"].join(", "),
				"Access-Control-Allow-Headers":
					request.headers.get("access-control-request-headers") ?? "Content-Type",
				"Access-Control-Max-Age": "86400",
			},
		});
	}
	return new Response(JSON.stringify({ error: "Method not allowed" }), {
		status: 405,
		headers: {
			"Content-Type": "application/json",
			Allow: [...WEBHOOK_METHODS, "GET", "HEAD", "OPTIONS"].join(", "),
		},
	});
}

// ── Worker export ──
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const host = classifyHost(request.headers.get("host"), env.TUNNEL_DOMAIN);
		if (host.kind === "channel") return handleChannelHost(host.channelId, request, env);
		// Only relay.<TUNNEL_DOMAIN> serves the API, auth and executor endpoints.
		// Every other in-zone host (www, api, foo-bar, a.b, …) is a 404;
		// app/docs never reach the Worker (Pages, script-less routes).
		if ((host.kind === "reserved" && host.label !== "relay") || host.kind === "zone") {
			return jsonResponse(404, { error: "Not Found" });
		}
		return app.fetch(request, env, ctx);
	},
	/**
	 * Scheduled handler — wired to `crons` in wrangler.toml.
	 * Hourly: expire anonymous channels, expire device codes, sweep events
	 * past their plan's retention window.
	 */
	async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
		try {
			const db = getDb(env);
			const expired = await db
				.delete(channels)
				.where(lt(channels.expiresAt, new Date()))
				.returning({ id: channels.id });
			if (expired.length > 0) {
				console.log(`Cron cleanup: deleted ${expired.length} expired channels`);
			}
			const codeCount = await cleanupExpiredDeviceCodes(db);
			if (codeCount > 0) {
				console.log(`Cron cleanup: deleted ${codeCount} expired device codes`);
			}
			// Skip retention sweep in self-host mode — the selfhost tier has
			// unlimited retention and there's nothing else to sweep.
			if (env.BETTER_AUTH_SECRET) {
				await retentionSweep(db);
			}
		} catch (err) {
			console.error("Cron cleanup failed:", err);
		}
	},
} satisfies ExportedHandler<Env>;

// NOTE: do not add named exports here. Cloudflare Workers treats every
// named export from the entry module as a binding and rejects values that
// aren't functions / Durable Object classes. If helpers need to be reused
// across modules, move them into a sibling file (e.g. ./lib.ts) and import
// from there.
