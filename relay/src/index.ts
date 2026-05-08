import {
	CHANNEL_EXPIRY_HOURS,
	MAX_BODY_SIZE_BYTES,
	MAX_BUFFERED_EVENTS,
	PLANS,
	type PlanId,
	TRIAL_DAYS,
} from "@bridgehook/shared";
import { events, channels, user as userTable } from "@bridgehook/shared/db/schema";
import { neon } from "@neondatabase/serverless";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { checkChannelCreate, loadUserAccess } from "./access.js";
import { createAuth, getSessionUser } from "./auth.js";
import { createPolarClient } from "./billing.js";
import { getOrCreateSelfHostUser, resolveCaller, touchDevice } from "./identity.js";
import { buildAuthDeviceRoutes, cleanupExpiredDeviceCodes } from "./routes/auth-device.js";
import { buildBillingRoutes } from "./routes/billing.js";
import { buildMeDevicesRoutes } from "./routes/me-devices.js";
import { buildMeRoutes } from "./routes/me.js";

export { ChannelDO } from "./channel-do.js";
export { UserDO } from "./user-do.js";

export interface Env {
	DATABASE_URL: string;
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
	/** Polar billing — when unset, /api/me/billing/* returns 503 and webhooks 404. */
	POLAR_ACCESS_TOKEN?: string;
	POLAR_WEBHOOK_SECRET?: string;
	POLAR_PRODUCT_ID_HOBBY?: string;
	POLAR_PRODUCT_ID_PRO?: string;
	POLAR_PRODUCT_ID_TEAM?: string;
	/**
	 * Apex domain for wildcard webhook intake (e.g. "bridgehook.dev").
	 * When set, requests to `<channelId>.<TUNNEL_DOMAIN>` route directly to the
	 * webhook receiver — no `/hook/<id>` prefix needed. When unset, only the
	 * legacy path-based `/hook/:channelId` route accepts webhooks (preserves
	 * dev/self-host without DNS).
	 */
	TUNNEL_DOMAIN?: string;
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

// ── Rate limit ────────────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_SEC = 60;
const RATE_LIMIT_MAX_PER_IP = 10;

// ── Cached DB connection ──────────────────────────────────────────────────
type DB = ReturnType<typeof drizzle>;
let cachedDb: DB | undefined;
let cachedDbUrl: string | undefined;

function getDb(env: Env): DB {
	if (cachedDb && cachedDbUrl === env.DATABASE_URL) return cachedDb;
	const sql = neon(env.DATABASE_URL);
	cachedDb = drizzle(sql);
	cachedDbUrl = env.DATABASE_URL;
	return cachedDb;
}

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

function isHex(s: string, len?: number): boolean {
	if (len !== undefined && s.length !== len) return false;
	return /^[0-9a-f]+$/i.test(s);
}

function getChannelDO(env: Env, channelId: string) {
	const id = env.CHANNEL.idFromName(channelId);
	return env.CHANNEL.get(id);
}

/**
 * Subdomains that resolve under TUNNEL_DOMAIN but are NOT channel ids — they
 * point at first-party properties (relay API, dashboard, docs site, etc.).
 * Anything else under the apex is treated as a tunnel host.
 */
const RESERVED_TUNNEL_SUBDOMAINS = new Set([
	"relay",
	"app",
	"www",
	"docs",
	"api",
	"admin",
	"status",
	"blog",
	"mail",
	"support",
]);

/** Channel id format: lowercase alphanumeric, 1–24 chars (matches CHANNEL_ID_LEN). */
const CHANNEL_ID_RE = /^[a-z0-9]{1,24}$/;

/**
 * Extract the channel id from a wildcard tunnel host, or `null` when the
 * request's Host header doesn't look like one.
 *
 *   "ch_abc123.bridgehook.dev"  →  "ch_abc123"
 *   "relay.bridgehook.dev"      →  null  (reserved)
 *   "bridgehook.dev"            →  null  (apex, no subdomain)
 *   "ch_abc.example.com"        →  null  (different domain)
 *   anything when TUNNEL_DOMAIN is unset → null  (feature off)
 *
 * Trailing dots are tolerated; ports are stripped; comparison is case-insensitive.
 */
function parseTunnelHost(rawHost: string | null, tunnelDomain: string | undefined): string | null {
	if (!rawHost || !tunnelDomain) return null;
	let hostname = rawHost.split(":")[0].toLowerCase();
	if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
	const apex = tunnelDomain.toLowerCase();
	if (!hostname.endsWith(`.${apex}`)) return null;
	const sub = hostname.slice(0, -apex.length - 1);
	// Single-label subdomain only — `foo.bar.bridgehook.dev` falls through.
	if (sub.length === 0 || sub.includes(".")) return null;
	if (RESERVED_TUNNEL_SUBDOMAINS.has(sub)) return null;
	if (!CHANNEL_ID_RE.test(sub)) return null;
	return sub;
}

/**
 * Canonical webhook URL for a channel. Subdomain shape when TUNNEL_DOMAIN is
 * set; legacy `${origin}/hook/<id>` otherwise so dev / self-host without DNS
 * keeps working.
 *
 * The protocol mirrors whatever the relay was reached over, which is correct
 * for both prod (https) and dev (http://localhost:8787 → http://<id>.localhost
 * is unusable, so dev defaults to the legacy path even with TUNNEL_DOMAIN set).
 */
function buildWebhookUrl(
	channelId: string,
	requestUrl: URL,
	tunnelDomain: string | undefined,
): string {
	if (tunnelDomain && requestUrl.protocol === "https:") {
		return `https://${channelId}.${tunnelDomain}`;
	}
	return `${requestUrl.origin}/hook/${channelId}`;
}

/**
 * Normalize an incoming request path so `events.path` always reads as the
 * post-prefix path the user's webhook source actually targeted.
 *
 *   path-based ("/hook/ch_abc/foo")        → "/foo"
 *   subdomain  ("/foo")                    → "/foo"
 *   bare prefix ("/hook/ch_abc")           → "/"
 *
 * Pre-launch this is a behavior change for any historical events with the
 * full prefix in their path column; the dashboard just renders the stored
 * value so old rows render with the legacy prefix and new rows without.
 */
function stripHookPrefix(requestPath: string, channelId: string): string {
	const prefix = `/hook/${channelId}`;
	if (requestPath === prefix) return "/";
	if (requestPath.startsWith(`${prefix}/`)) return requestPath.slice(prefix.length);
	return requestPath;
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
 * shared by the legacy `/hook/:channelId` route and the wildcard subdomain
 * dispatcher. Validates, persists the event row, fans out via both the
 * channel DO (per-channel SSE) and the user DO (cross-channel dashboard), and
 * returns 202 immediately. Never awaits localhost — the executor's response
 * lands later via `POST /hook/:channelId/response` and updates the row
 * out-of-band.
 *
 * `events.path` is stored post-prefix so the dashboard renders consistently
 * regardless of whether the producer hit the wildcard or legacy URL.
 */
async function handleWebhookIntake(
	channelId: string,
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
	const cleanPath = stripHookPrefix(url.pathname, channelId);

	const allowedPaths = safeJsonParse<string[]>(channel.allowedPaths, []);
	if (!isPathAllowed(cleanPath, allowedPaths)) {
		return jsonResponse(403, { error: "Path not allowed for this channel" });
	}

	const headers: Record<string, string> = {};
	let headersBytes = 0;
	request.headers.forEach((value, key) => {
		headersBytes += key.length + value.length + 4;
		headers[key] = value;
	});
	if (headersBytes > MAX_HEADERS_BYTES) {
		return jsonResponse(431, { error: "Headers too large" });
	}

	const body = await request.text();
	if (body.length > MAX_BODY_SIZE_BYTES) {
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
	stub
		.fetch(new Request("https://do/notify", { method: "POST", body: ssePayload }))
		.catch((err) => console.error("DO notify failed:", err));

	// Cross-channel dashboard fan-out: only when the channel has an owner.
	notifyUserDO(env, channel.userId, ssePayload);

	return jsonResponse(202, { received: true, eventId: evt.id, channelId });
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

/**
 * Match the request path against the channel's allowedPaths whitelist.
 * Caller is responsible for passing the cleaned (post-prefix) path — see
 * {@link stripHookPrefix}.
 */
function isPathAllowed(requestPath: string, allowedPaths: string[]): boolean {
	if (allowedPaths.length === 0) return true;
	return allowedPaths.some((p) => requestPath === p || requestPath.startsWith(`${p}/`));
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

/**
 * CORS with credentials. When the request carries an Origin header, echo it
 * back specifically (NOT `*`) and set Allow-Credentials so the browser sends
 * the Better-Auth session cookie. This is required for cross-subdomain
 * relay/<→/app calls; same-origin still works.
 */
app.use(
	"*",
	cors({
		origin: (origin) => origin ?? "*",
		allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization", "X-BH-Timestamp", "X-BH-Signature"],
		maxAge: 86400,
		credentials: true,
	}),
);

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
// Long-lived session-authed SSE. Pushes every webhook / response / claim
// event for any channel owned by the current user. Heartbeats every 20s
// inside the UserDO so intermediaries don't kill the connection.
//
// Self-host mode (no auth) returns 404. The dashboard's per-channel
// polling stays as a fallback when this stream is unavailable.
app.get("/api/me/stream", async (c) => {
	const auth = createAuth(c.env);
	if (!auth) return c.json({ error: "Auth not configured" }, 404);

	const sessionUser = await getSessionUser(auth, c.req.raw);
	if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

	const stub = getUserDO(c.env, sessionUser.id);
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

// ── Health ──
app.get("/health", (c) => c.json({ status: "ok" }));

// ── Config probe (public, unauthenticated) ──
// Web/extension call this once at startup to know whether the relay is
// running in hosted (auth-enabled) or self-host (auth-disabled) mode and
// gate UI affordances accordingly. `billingEnabled` is independent — a
// hosted instance can run without Polar (env unset → /api/me/billing/* 503),
// in which case the Billing page hides checkout buttons and shows a
// "billing not configured" notice instead.
app.get("/api/config", (c) => {
	const authEnabled = Boolean(c.env.BETTER_AUTH_SECRET);
	const billingEnabled = authEnabled && Boolean(c.env.POLAR_ACCESS_TOKEN);
	return c.json({
		authEnabled,
		signupEnabled: authEnabled,
		billingEnabled,
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
	const rows = await db
		.select()
		.from(events)
		.where(eq(events.channelId, channelId))
		.orderBy(desc(events.receivedAt))
		.limit(limit);

	return c.json(rows);
});

// ── Receive webhook (public, path-based — back-compat) ──
// Subdomain intake (`<channelId>.<TUNNEL_DOMAIN>`) is wired in the worker
// entry below; both paths funnel through {@link handleWebhookIntake} so the
// behavior stays identical.
app.on(["POST", "PUT", "PATCH"], "/hook/:channelId", async (c) => {
	return handleWebhookIntake(c.req.param("channelId"), c.req.raw, c.env);
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

	// Atomic claim: only the row whose claimed_by_device_id is still NULL
	// flips. Composite WHERE also pins to this channel so a poisoned eventId
	// from one channel can't claim another's event.
	const claimedAt = new Date();
	const claimed = await db
		.update(events)
		.set({ claimedByDeviceId: clientId, claimedAt })
		.where(
			and(
				eq(events.id, eventId),
				eq(events.channelId, channelId),
				isNull(events.claimedByDeviceId),
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

	const respHeaders =
		parsed.headers && typeof parsed.headers === "object" && !Array.isArray(parsed.headers)
			? (parsed.headers as Record<string, string>)
			: {};
	const respBody = typeof parsed.body === "string" ? parsed.body : "";
	const latencyMs =
		typeof parsed.latencyMs === "number" && Number.isFinite(parsed.latencyMs)
			? Math.max(0, Math.round(parsed.latencyMs))
			: 0;

	await db
		.update(events)
		.set({
			responseStatus: parsed.status,
			responseHeaders: JSON.stringify(respHeaders),
			responseBody: respBody,
			latencyMs,
		})
		.where(eq(events.id, parsed.eventId));

	const responsePayload = JSON.stringify({
		type: "response",
		eventId: parsed.eventId,
		channelId,
		status: parsed.status,
		latencyMs,
	});

	const stub = getChannelDO(c.env, channelId);
	stub
		.fetch(new Request("https://do/notify", { method: "POST", body: responsePayload }))
		.catch((err) => console.error("DO notify failed:", err));
	notifyUserDO(c.env, channel.userId, responsePayload);

	return c.json({ ok: true });
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

		// Two-step: collect channel ids owned by users on this plan, then
		// delete events on those channels older than the cutoff. A single
		// JOIN-DELETE would be more efficient but Drizzle's neon-http
		// adapter doesn't expose a clean DELETE-USING shape.
		const ownedChannelRows = await db
			.select({ id: channels.id })
			.from(channels)
			.innerJoin(userTable, eq(channels.userId, userTable.id))
			.where(eq(userTable.plan, planId));

		if (ownedChannelRows.length === 0) continue;
		const channelIds = ownedChannelRows.map((r) => r.id);

		const deleted = await db
			.delete(events)
			.where(and(inArray(events.channelId, channelIds), lt(events.receivedAt, cutoff)))
			.returning({ id: events.id });

		if (deleted.length > 0) {
			console.log(
				`Retention sweep [${planId}]: deleted ${deleted.length} events older than ${retention}d`,
			);
		}
	}
}

// ── Worker export ──
//
// The fetch entry runs *before* Hono. Two shapes of request reach the worker:
//
//   1. Wildcard tunnel host (`<channelId>.<TUNNEL_DOMAIN>`):
//        • POST/PUT/PATCH → straight into {@link handleWebhookIntake}
//        • OPTIONS         → CORS-friendly 204 (preflight succeeds, no body)
//        • Anything else   → 405 with an Allow header (the "no website hosting"
//                            edge guard from Phase 2 of the hardening plan).
//      Hono is bypassed entirely for these so we don't accidentally pick up
//      `/auth/**`, `/api/**`, etc. on a host that's supposed to be webhook-only.
//
//   2. First-party host (relay.<apex>, app.<apex>, localhost during dev, …):
//        • Falls through to `app.fetch` — the Hono app handles everything.
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const tunnelChannelId = parseTunnelHost(request.headers.get("host"), env.TUNNEL_DOMAIN);
		if (tunnelChannelId !== null) {
			const method = request.method.toUpperCase();
			if (method === "POST" || method === "PUT" || method === "PATCH") {
				return handleWebhookIntake(tunnelChannelId, request, env);
			}
			if (method === "OPTIONS") {
				return new Response(null, {
					status: 204,
					headers: {
						"Access-Control-Allow-Origin": request.headers.get("origin") ?? "*",
						"Access-Control-Allow-Methods": "POST, PUT, PATCH, OPTIONS",
						"Access-Control-Allow-Headers":
							request.headers.get("access-control-request-headers") ?? "Content-Type",
						"Access-Control-Max-Age": "86400",
					},
				});
			}
			return new Response("Method Not Allowed", {
				status: 405,
				headers: { Allow: "POST, PUT, PATCH, OPTIONS" },
			});
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
