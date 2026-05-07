import {
	CHANNEL_EXPIRY_HOURS,
	MAX_BODY_SIZE_BYTES,
	MAX_BUFFERED_EVENTS,
	TRIAL_DAYS,
} from "@bridgehook/shared";
import { events, channels } from "@bridgehook/shared/db/schema";
import { neon } from "@neondatabase/serverless";
import { desc, eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth, getSessionUser } from "./auth.js";
import { getOrCreateSelfHostUser, resolveCaller, touchDevice } from "./identity.js";
import { buildAuthDeviceRoutes, cleanupExpiredDeviceCodes } from "./routes/auth-device.js";
import { buildMeDevicesRoutes } from "./routes/me-devices.js";
import { buildMeRoutes } from "./routes/me.js";

export { ChannelDO } from "./channel-do.js";

export interface Env {
	DATABASE_URL: string;
	CHANNEL: DurableObjectNamespace;
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
/** SHA-256 hex (legacy bearer scheme). */
const SECRET_HASH_HEX_LEN = 64;
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

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

function extractBearer(request: Request): string | null {
	const auth = request.headers.get("Authorization") || request.headers.get("authorization");
	if (!auth) return null;
	const m = auth.match(/^Bearer\s+(.+)$/);
	return m ? m[1].trim() : null;
}

function getChannelDO(env: Env, channelId: string) {
	const id = env.CHANNEL.idFromName(channelId);
	return env.CHANNEL.get(id);
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

function isPathAllowed(requestPath: string, allowedPaths: string[]): boolean {
	if (allowedPaths.length === 0) return true;
	const cleaned = requestPath.replace(/^\/hook\/[a-z0-9]+/, "") || "/";
	return allowedPaths.some((p) => cleaned === p || cleaned.startsWith(`${p}/`));
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
type AuthCredential =
	| { type: "ecdsa"; publicKeyHex: string }
	| { type: "bearer"; secretHash: string };

function pickCredential(channel: {
	publicKey: string | null;
	secretHash: string | null;
}): AuthCredential | null {
	if (channel.publicKey) return { type: "ecdsa", publicKeyHex: channel.publicKey };
	if (channel.secretHash) return { type: "bearer", secretHash: channel.secretHash };
	return null;
}

async function verifyAndReadBody(
	request: Request,
	cred: AuthCredential,
): Promise<{ ok: true; body: string } | { ok: false; status: number; error: string }> {
	if (cred.type === "ecdsa") {
		return verifyEcdsa(request, cred.publicKeyHex);
	}
	return verifyBearer(request, cred.secretHash);
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

async function verifyBearer(
	request: Request,
	storedHash: string,
): Promise<{ ok: true; body: string } | { ok: false; status: number; error: string }> {
	const provided = extractBearer(request);
	if (!provided) {
		return { ok: false, status: 401, error: "Missing bearer token" };
	}
	const providedHash = await sha256Hex(provided);
	if (!constantTimeEqual(providedHash, storedHash)) {
		return { ok: false, status: 401, error: "Invalid bearer token" };
	}
	const body = await request.text();
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

// ── /api/me/* (account read endpoints + channel management) ──────────────
app.route(
	"/api/me",
	buildMeRoutes((c) => {
		const env = (c as { env: Env }).env;
		const auth = createAuth(env);
		if (!auth) return null;
		return { auth, db: getDb(env) };
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
// gate UI affordances accordingly.
app.get("/api/config", (c) => {
	const authEnabled = Boolean(c.env.BETTER_AUTH_SECRET);
	return c.json({
		authEnabled,
		signupEnabled: authEnabled,
		trialDays: TRIAL_DAYS,
		version: RELAY_VERSION,
	});
});

// ── Create channel ──
// In hosted mode (BETTER_AUTH_SECRET set), requires either a Better-Auth
// session cookie OR a device-token Bearer header. Anonymous creates return
// 401. The legacy bearer (secretHash) scheme is rejected at this endpoint;
// existing channels with secretHash continue to verify on per-channel ops.
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
	} else {
		userId = await getOrCreateSelfHostUser(db, env);
	}

	const body = await safeReadJson<{
		publicKey?: unknown;
		secretHash?: unknown;
		port?: unknown;
		allowedPaths?: unknown;
		label?: unknown;
	}>(c.req.raw);

	if (!body) return c.json({ error: "Invalid JSON body" }, 400);

	// Reject the legacy bearer scheme on new creates. Per-channel verification
	// still accepts secretHash for existing rows; a later commit drops the column.
	if (typeof body.secretHash === "string" && body.secretHash.length > 0) {
		return c.json(
			{
				error:
					"The secretHash (legacy bearer) scheme is no longer accepted for new channels. Send publicKey (ECDSA P-256, 130 hex chars) instead.",
			},
			400,
		);
	}

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
			secretHash: null,
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
			webhookUrl: `${url.origin}/hook/${channel.id}`,
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
		webhookUrl: `${url.origin}/hook/${channel.id}`,
		authScheme: channel.publicKey ? "ecdsa" : "bearer",
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

	// Otherwise require ECDSA (or legacy bearer for old channels).
	const cred = pickCredential(channel);
	if (!cred) return c.json({ error: "Channel misconfigured" }, 500);

	const verified = await verifyAndReadBody(c.req.raw, cred);
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

	const cred = pickCredential(channel);
	if (!cred) return c.json({ error: "Channel misconfigured" }, 500);

	const verified = await verifyAndReadBody(c.req.raw, cred);
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

// ── Receive webhook (public) ──
app.on(["POST", "PUT", "PATCH"], "/hook/:channelId", async (c) => {
	const channelId = c.req.param("channelId");
	if (!/^[a-z0-9]{1,24}$/.test(channelId)) {
		return c.json({ error: "Channel not found" }, 404);
	}
	const db = getDb(c.env);

	const claimed = Number(c.req.header("content-length") || "0");
	if (claimed > MAX_BODY_SIZE_BYTES) {
		return c.json({ error: "Body too large" }, 413);
	}

	const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
	if (!channel) return c.json({ error: "Channel not found" }, 404);

	const url = new URL(c.req.url);
	const allowedPaths = safeJsonParse<string[]>(channel.allowedPaths, []);
	if (!isPathAllowed(url.pathname, allowedPaths)) {
		return c.json({ error: "Path not allowed for this channel" }, 403);
	}

	const headers: Record<string, string> = {};
	let headersBytes = 0;
	c.req.raw.headers.forEach((value, key) => {
		headersBytes += key.length + value.length + 4;
		headers[key] = value;
	});
	if (headersBytes > MAX_HEADERS_BYTES) {
		return c.json({ error: "Headers too large" }, 431);
	}

	const body = await c.req.raw.text();
	if (body.length > MAX_BODY_SIZE_BYTES) {
		return c.json({ error: "Body too large" }, 413);
	}

	const eventId = crypto.randomUUID().replace(/-/g, "").slice(0, EVENT_ID_LEN);
	const [evt] = await db
		.insert(events)
		.values({
			id: eventId,
			channelId,
			method: c.req.method,
			path: url.pathname,
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

	const stub = getChannelDO(c.env, channelId);
	stub
		.fetch(new Request("https://do/notify", { method: "POST", body: ssePayload }))
		.catch((err) => console.error("DO notify failed:", err));

	return c.json({ received: true, eventId: evt.id, channelId }, 202);
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

	const cred = pickCredential(channel);
	if (!cred) return c.json({ error: "Channel misconfigured" }, 500);

	const verified = await verifyAndReadBody(c.req.raw, cred);
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
		status: parsed.status,
		latencyMs,
	});

	const stub = getChannelDO(c.env, channelId);
	stub
		.fetch(new Request("https://do/notify", { method: "POST", body: responsePayload }))
		.catch((err) => console.error("DO notify failed:", err));

	return c.json({ ok: true });
});

// ── Catch-all 404 ──
app.notFound((c) => c.json({ error: "Not Found" }, 404));

// ── Worker export ──
export default {
	fetch: app.fetch,
	/**
	 * Scheduled handler — wired to `crons` in wrangler.toml.
	 * Deletes expired channels (and cascades their events) hourly.
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
