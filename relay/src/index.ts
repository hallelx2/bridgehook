import { CHANNEL_EXPIRY_HOURS, MAX_BODY_SIZE_BYTES, MAX_BUFFERED_EVENTS } from "@bridgehook/shared";
import { events, channels } from "@bridgehook/shared/db/schema";
import { neon } from "@neondatabase/serverless";
import { desc, eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

export { ChannelDO } from "./channel-do.js";

export interface Env {
	DATABASE_URL: string;
	CHANNEL: DurableObjectNamespace;
	/** Optional: KV namespace for rate-limit counters. Falls back to no-op if absent. */
	RATE_LIMIT?: KVNamespace;
}

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
const RATE_LIMIT_MAX_PER_IP = 10; // channels per minute per IP

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

// ── CORS ──────────────────────────────────────────────────────────────────
function corsHeaders(origin?: string): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": origin || "*",
		"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization, X-BH-Timestamp, X-BH-Signature",
		"Access-Control-Max-Age": "86400",
	};
}

function json(data: unknown, status = 200, origin?: string): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			...corsHeaders(origin),
		},
	});
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

/** Constant-time string compare. Both must be the same length. */
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
/**
 * Per-IP token bucket on Cloudflare KV. Returns true if the request should be
 * allowed, false if rate-limited. If KV is unavailable (no binding), always
 * allows — rate limiting is best-effort, not a security boundary on its own.
 */
async function checkRateLimit(env: Env, request: Request, key: string): Promise<boolean> {
	if (!env.RATE_LIMIT) return true; // KV not configured — soft-fail
	const ip =
		request.headers.get("CF-Connecting-IP") ||
		request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
		"unknown";
	const bucket = `rl:${key}:${ip}`;

	try {
		const current = await env.RATE_LIMIT.get(bucket);
		const count = current ? Number.parseInt(current, 10) : 0;
		if (count >= RATE_LIMIT_MAX_PER_IP) return false;
		// KV writes have ~60s consistency lag, but for "max N per minute" that's fine.
		await env.RATE_LIMIT.put(bucket, String(count + 1), {
			expirationTtl: RATE_LIMIT_WINDOW_SEC,
		});
		return true;
	} catch (err) {
		console.error("Rate limit KV error:", err);
		return true; // soft-fail
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

/**
 * Verify a request and return the body string (already consumed). Caller can
 * then parse JSON if needed without re-reading.
 */
async function verifyAndReadBody(
	request: Request,
	cred: AuthCredential,
	origin: string | undefined,
): Promise<{ ok: true; body: string } | { ok: false; response: Response }> {
	if (cred.type === "ecdsa") {
		return verifyEcdsa(request, cred.publicKeyHex, origin);
	}
	return verifyBearer(request, cred.secretHash, origin);
}

async function verifyEcdsa(
	request: Request,
	publicKeyHex: string,
	origin: string | undefined,
): Promise<{ ok: true; body: string } | { ok: false; response: Response }> {
	const timestamp = request.headers.get("X-BH-Timestamp");
	const signatureHex = request.headers.get("X-BH-Signature");

	if (!timestamp || !signatureHex) {
		return { ok: false, response: json({ error: "Missing signature" }, 401, origin) };
	}
	if (!isHex(signatureHex, SIGNATURE_HEX_LEN)) {
		return { ok: false, response: json({ error: "Invalid signature format" }, 401, origin) };
	}

	const ts = Number(timestamp);
	if (!Number.isFinite(ts)) {
		return { ok: false, response: json({ error: "Invalid timestamp" }, 401, origin) };
	}
	if (Math.abs(Date.now() - ts) > SIGNATURE_MAX_SKEW_MS) {
		return { ok: false, response: json({ error: "Timestamp outside window" }, 401, origin) };
	}

	if (!isHex(publicKeyHex, PUBLIC_KEY_HEX_LEN)) {
		return { ok: false, response: json({ error: "Channel misconfigured" }, 500, origin) };
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
		return { ok: false, response: json({ error: "Channel misconfigured" }, 500, origin) };
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
		return { ok: false, response: json({ error: "Invalid signature" }, 401, origin) };
	}

	return { ok: true, body };
}

async function verifyBearer(
	request: Request,
	storedHash: string,
	origin: string | undefined,
): Promise<{ ok: true; body: string } | { ok: false; response: Response }> {
	const provided = extractBearer(request);
	if (!provided) {
		return { ok: false, response: json({ error: "Missing bearer token" }, 401, origin) };
	}
	const providedHash = await sha256Hex(provided);
	if (!constantTimeEqual(providedHash, storedHash)) {
		return { ok: false, response: json({ error: "Invalid bearer token" }, 401, origin) };
	}
	const body = await request.text();
	return { ok: true, body };
}

// ── Route regexes ─────────────────────────────────────────────────────────
const RE_CHANNEL = /^\/api\/channels\/([a-z0-9]{1,24})$/;
const RE_CHANNEL_EVENTS = /^\/api\/channels\/([a-z0-9]{1,24})\/events$/;
const RE_HOOK_RESPONSE = /^\/hook\/([a-z0-9]{1,24})\/response$/;
const RE_HOOK_RECEIVE = /^\/hook\/([a-z0-9]{1,24})$/;

export default {
	/**
	 * Scheduled handler — wired to `crons` in wrangler.toml.
	 * Deletes expired channels (and cascades their events) hourly.
	 */
	async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
		try {
			const db = getDb(env);
			const result = await db.delete(channels).where(lt(channels.expiresAt, new Date())).returning({
				id: channels.id,
			});
			if (result.length > 0) {
				console.log(`Cron cleanup: deleted ${result.length} expired channels`);
			}
		} catch (err) {
			console.error("Cron cleanup failed:", err);
		}
	},

	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const origin = request.headers.get("Origin") || undefined;

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders(origin) });
		}

		try {
			const db = getDb(env);

			// ── Health ──
			if (path === "/health") {
				return json({ status: "ok" }, 200, origin);
			}

			// ── Create channel (rate-limited, accepts either credential) ──
			if (path === "/api/channels" && request.method === "POST") {
				if (!(await checkRateLimit(env, request, "create"))) {
					return json({ error: "Rate limit exceeded" }, 429, origin);
				}

				const body = await safeReadJson<{
					publicKey?: unknown;
					secretHash?: unknown;
					port?: unknown;
					allowedPaths?: unknown;
				}>(request);

				if (!body) return json({ error: "Invalid JSON body" }, 400, origin);

				// Choose auth scheme: prefer ECDSA when both somehow appear.
				let publicKey: string | null = null;
				let secretHash: string | null = null;

				if (typeof body.publicKey === "string" && body.publicKey.length > 0) {
					if (!isHex(body.publicKey, PUBLIC_KEY_HEX_LEN)) {
						return json({ error: "publicKey must be a 130-char hex string" }, 400, origin);
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
						return json({ error: "publicKey is not a valid ECDSA P-256 point" }, 400, origin);
					}
					publicKey = body.publicKey;
				} else if (typeof body.secretHash === "string" && body.secretHash.length > 0) {
					if (!isHex(body.secretHash, SECRET_HASH_HEX_LEN)) {
						return json({ error: "secretHash must be 64-char hex (SHA-256)" }, 400, origin);
					}
					secretHash = body.secretHash;
				} else {
					return json(
						{ error: "Provide one of publicKey (recommended) or secretHash" },
						400,
						origin,
					);
				}

				if (
					typeof body.port !== "number" ||
					!Number.isInteger(body.port) ||
					body.port < 1 ||
					body.port > 65535
				) {
					return json({ error: "port must be an integer 1-65535" }, 400, origin);
				}

				const allowedPaths = validateAllowedPaths(body.allowedPaths ?? []);
				if (allowedPaths === null) {
					return json(
						{ error: "allowedPaths must be an array of path strings starting with /" },
						400,
						origin,
					);
				}

				const channelId = crypto.randomUUID().replace(/-/g, "").slice(0, CHANNEL_ID_LEN);
				const expiresAt = new Date(Date.now() + CHANNEL_EXPIRY_HOURS * 60 * 60 * 1000);

				const [channel] = await db
					.insert(channels)
					.values({
						id: channelId,
						publicKey,
						secretHash,
						port: body.port,
						allowedPaths: JSON.stringify(allowedPaths),
						expiresAt,
					})
					.returning();

				return json(
					{
						channelId: channel.id,
						port: channel.port,
						expiresAt: channel.expiresAt.toISOString(),
						webhookUrl: `${url.origin}/hook/${channel.id}`,
						authScheme: publicKey ? "ecdsa" : "bearer",
					},
					201,
					origin,
				);
			}

			// ── Channel info (public) / delete (auth) ──
			{
				const m = path.match(RE_CHANNEL);
				if (m && request.method === "GET") {
					const channelId = m[1];
					const [channel] = await db
						.select()
						.from(channels)
						.where(eq(channels.id, channelId))
						.limit(1);

					if (!channel) return json({ error: "Channel not found" }, 404, origin);

					return json(
						{
							id: channel.id,
							port: channel.port,
							allowedPaths: safeJsonParse<string[]>(channel.allowedPaths, []),
							createdAt: channel.createdAt.toISOString(),
							expiresAt: channel.expiresAt.toISOString(),
							webhookUrl: `${url.origin}/hook/${channel.id}`,
							authScheme: channel.publicKey ? "ecdsa" : "bearer",
						},
						200,
						origin,
					);
				}
				if (m && request.method === "DELETE") {
					const channelId = m[1];
					const [channel] = await db
						.select()
						.from(channels)
						.where(eq(channels.id, channelId))
						.limit(1);
					if (!channel) return json({ error: "Channel not found" }, 404, origin);

					const cred = pickCredential(channel);
					if (!cred) return json({ error: "Channel misconfigured" }, 500, origin);

					const verified = await verifyAndReadBody(request, cred, origin);
					if (!verified.ok) return verified.response;

					await db.delete(channels).where(eq(channels.id, channelId));
					return json({ deleted: true }, 200, origin);
				}
			}

			// ── List events (auth) ──
			{
				const m = path.match(RE_CHANNEL_EVENTS);
				if (m && request.method === "GET") {
					const channelId = m[1];
					const [channel] = await db
						.select()
						.from(channels)
						.where(eq(channels.id, channelId))
						.limit(1);
					if (!channel) return json({ error: "Channel not found" }, 404, origin);

					const cred = pickCredential(channel);
					if (!cred) return json({ error: "Channel misconfigured" }, 500, origin);

					const verified = await verifyAndReadBody(request, cred, origin);
					if (!verified.ok) return verified.response;

					const limit = parseLimit(url.searchParams.get("limit"));
					const rows = await db
						.select()
						.from(events)
						.where(eq(events.channelId, channelId))
						.orderBy(desc(events.receivedAt))
						.limit(limit);

					return json(rows, 200, origin);
				}
			}

			// ── Receive webhook (public) ──
			{
				const m = path.match(RE_HOOK_RECEIVE);
				if (m && ["POST", "PUT", "PATCH"].includes(request.method)) {
					const channelId = m[1];

					const claimed = Number(request.headers.get("content-length") || "0");
					if (claimed > MAX_BODY_SIZE_BYTES) {
						return json({ error: "Body too large" }, 413, origin);
					}

					const [channel] = await db
						.select()
						.from(channels)
						.where(eq(channels.id, channelId))
						.limit(1);
					if (!channel) return json({ error: "Channel not found" }, 404, origin);

					const allowedPaths = safeJsonParse<string[]>(channel.allowedPaths, []);
					if (!isPathAllowed(url.pathname, allowedPaths)) {
						return json({ error: "Path not allowed for this channel" }, 403, origin);
					}

					const headers: Record<string, string> = {};
					let headersBytes = 0;
					request.headers.forEach((value, key) => {
						headersBytes += key.length + value.length + 4;
						headers[key] = value;
					});
					if (headersBytes > MAX_HEADERS_BYTES) {
						return json({ error: "Headers too large" }, 431, origin);
					}

					const body = await request.text();
					if (body.length > MAX_BODY_SIZE_BYTES) {
						return json({ error: "Body too large" }, 413, origin);
					}

					const eventId = crypto.randomUUID().replace(/-/g, "").slice(0, EVENT_ID_LEN);
					const [evt] = await db
						.insert(events)
						.values({
							id: eventId,
							channelId,
							method: request.method,
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

					const stub = getChannelDO(env, channelId);
					stub
						.fetch(new Request("https://do/notify", { method: "POST", body: ssePayload }))
						.catch((err) => console.error("DO notify failed:", err));

					return json({ received: true, eventId: evt.id, channelId }, 202, origin);
				}
			}

			// ── Receive response from client (auth) ──
			{
				const m = path.match(RE_HOOK_RESPONSE);
				if (m && request.method === "POST") {
					const channelId = m[1];
					const [channel] = await db
						.select()
						.from(channels)
						.where(eq(channels.id, channelId))
						.limit(1);
					if (!channel) return json({ error: "Channel not found" }, 404, origin);

					const cred = pickCredential(channel);
					if (!cred) return json({ error: "Channel misconfigured" }, 500, origin);

					const verified = await verifyAndReadBody(request, cred, origin);
					if (!verified.ok) return verified.response;

					let raw: unknown;
					try {
						raw = JSON.parse(verified.body);
					} catch {
						return json({ error: "Invalid JSON body" }, 400, origin);
					}
					if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
						return json({ error: "Invalid JSON body" }, 400, origin);
					}
					const parsed = raw as {
						eventId?: unknown;
						status?: unknown;
						headers?: unknown;
						body?: unknown;
						latencyMs?: unknown;
					};

					if (typeof parsed.eventId !== "string" || !/^[a-z0-9]{1,32}$/.test(parsed.eventId)) {
						return json({ error: "Invalid eventId" }, 400, origin);
					}
					if (
						typeof parsed.status !== "number" ||
						!Number.isInteger(parsed.status) ||
						parsed.status < 0 ||
						parsed.status >= 1000
					) {
						return json({ error: "Invalid status" }, 400, origin);
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

					const stub = getChannelDO(env, channelId);
					stub
						.fetch(new Request("https://do/notify", { method: "POST", body: responsePayload }))
						.catch((err) => console.error("DO notify failed:", err));

					return json({ ok: true }, 200, origin);
				}
			}

			return json({ error: "Not Found" }, 404, origin);
		} catch (err) {
			console.error("Relay error:", err);
			return json({ error: "Internal Server Error" }, 500, origin);
		}
	},
} satisfies ExportedHandler<Env>;
