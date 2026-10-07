/**
 * BridgeHook Extension — Background Service Worker
 *
 * Replaces the browser tab as the bridge between the relay and localhost.
 * Extensions are exempt from CORS / mixed-content so HTTPS-relay → HTTP-
 * localhost forwarding works without ceremony.
 *
 * Auth (in priority order):
 *   1. Dashboard session cookie — if the user is signed in at
 *      bridgehook-web.pages.dev, the relay's cookie travels on
 *      `fetch(..., { credentials: "include" })` because we set it as
 *      SameSite=None on the relay. Zero pairing required.
 *   2. Device-token bearer — long-lived `dvc_…` from the OAuth-style
 *      device-pair flow. Survives sign-out, useful for headless setups.
 *   3. Anonymous — works only against self-host relays (no
 *      BETTER_AUTH_SECRET set).
 *
 * Channel keys remain non-extractable ECDSA P-256 in IndexedDB. Per-event
 * signatures (claim / response) sign the canonical request with the
 * channel's private key regardless of which auth mode mints the channel.
 *
 * MV3 resilience: a `bh-heartbeat` chrome.alarms wakes the SW every 30s
 * (the MV3 minimum) and re-attaches polling for any active service whose
 * loop died with the SW. The in-tick 2-3s polling continues as long as
 * the SW is alive.
 */

const RELAY_URL = "https://relay.bridgehook.dev";
/** Events fetched per page when draining a channel's delivery queue. */
const PENDING_PAGE_SIZE = 100;
/**
 * Longest a local handler may take before the attempt counts as failed.
 * Generous on purpose: stepping through a handler on a breakpoint must not
 * fail the webhook (the claim heartbeat keeps it ours meanwhile), but a
 * handler that never answers must not hold the queue forever. Three such
 * timeouts skip the event (see MAX_FORWARD_ATTEMPTS).
 */
const LOCALHOST_TIMEOUT_MS = 5 * 60 * 1000;
const WEB_URL = "https://app.bridgehook.dev";

// ── Storage keys ─────────────────────────────────────────────────────

const DEVICE_TOKEN_KEY = "bh_device_v1";
const SERVICES_KEY = "services";

// ── Account state ────────────────────────────────────────────────────
//
// In-memory cache rehydrated on SW boot. The dashboard probe runs on
// every popup open and on each heartbeat tick.

/** @typedef {"session" | "device" | null} AuthSource */
/** @typedef {{ source: AuthSource, user: {id?: string, email?: string, name?: string} | null,
 *             eventsToday: number, eventsPerDay: number | null, plan: string | null,
 *             deviceLabel: string | null }} AccountState */

/** @type {AccountState} */
let account = {
	source: null,
	user: null,
	eventsToday: 0,
	eventsPerDay: null,
	plan: null,
	deviceLabel: null,
};

async function getStoredDeviceToken() {
	const out = await chrome.storage.local.get([DEVICE_TOKEN_KEY]);
	const raw = out[DEVICE_TOKEN_KEY];
	if (!raw || typeof raw !== "object" || typeof raw.token !== "string") return null;
	return raw;
}
async function storeDeviceToken(record) {
	await chrome.storage.local.set({ [DEVICE_TOKEN_KEY]: record });
}
async function clearDeviceToken() {
	await chrome.storage.local.remove([DEVICE_TOKEN_KEY]);
}

/**
 * Probe the relay for the current identity. Tries the dashboard cookie
 * first (no Authorization header), falls back to the device token if
 * the cookie probe returns 401. Returns the resolved account state and
 * also mutates the module-level `account` so message handlers can read it.
 */
async function refreshAccount() {
	const prevSource = account.source;

	// 1. Cookie probe — credentials: include sends any SameSite=None cookie
	//    we already have for the relay host.
	try {
		const res = await fetch(`${RELAY_URL}/api/me`, {
			method: "GET",
			credentials: "include",
		});
		if (res.ok) {
			const me = await res.json();
			account = {
				source: "session",
				user: { id: me.user?.id, email: me.user?.email, name: me.user?.name },
				eventsToday: typeof me.eventsToday === "number" ? me.eventsToday : 0,
				eventsPerDay: typeof me.eventsPerDay === "number" ? me.eventsPerDay : null,
				plan: typeof me.plan === "string" ? me.plan : null,
				deviceLabel: null,
			};
			// First-time session detect on this browser → also self-register
			// as a device so the dashboard's Devices page shows this
			// extension. Subsequent sessions skip this because the device
			// token persists in chrome.storage.
			const existing = await getStoredDeviceToken();
			if (!existing) {
				await selfRegisterDevice().catch((err) => {
					console.warn("[BridgeHook] self-register failed:", err);
				});
			}
			// Kick off (or keep) the push-based stream.
			if (prevSource !== "session") {
				startUserStream().catch((err) => {
					console.warn("[BridgeHook] start stream failed:", err);
				});
			}
			return account;
		}
	} catch {
		// fall through to device-token
	}

	// 2. Device-token probe — if we have a paired token, hit /api/me with
	//    Authorization: Bearer and report the same shape.
	const device = await getStoredDeviceToken();
	if (device?.token) {
		try {
			const res = await fetch(`${RELAY_URL}/api/me`, {
				headers: { Authorization: `Bearer ${device.token}` },
			});
			if (res.ok) {
				const me = await res.json();
				account = {
					source: "device",
					user: { id: me.user?.id, email: me.user?.email, name: me.user?.name },
					eventsToday: typeof me.eventsToday === "number" ? me.eventsToday : 0,
					eventsPerDay: typeof me.eventsPerDay === "number" ? me.eventsPerDay : null,
					plan: typeof me.plan === "string" ? me.plan : null,
					deviceLabel: device.label ?? null,
				};
				// Device-mode can't use /api/me/stream (cookie-only). Tear
				// down any session-mode stream we still hold and fall back
				// to polling.
				if (prevSource === "session") stopUserStream();
				return account;
			}
		} catch {
			// fall through to anonymous
		}
	}

	// 3. Anonymous (works on self-host relays only).
	account = {
		source: null,
		user: null,
		eventsToday: 0,
		eventsPerDay: null,
		plan: null,
		deviceLabel: null,
	};
	if (prevSource === "session") stopUserStream();
	return account;
}

/**
 * Decorate fetch init with the right auth header. When auth.source is
 * "session", we let the cookie travel and set credentials: include. For
 * "device" we attach Authorization: Bearer.
 */
async function withAuth(init = {}) {
	const headers = new Headers(init.headers);
	if (account.source === "session") {
		return { ...init, credentials: "include", headers };
	}
	if (account.source === "device") {
		const device = await getStoredDeviceToken();
		if (device?.token) headers.set("Authorization", `Bearer ${device.token}`);
		return { ...init, headers };
	}
	return { ...init, headers };
}

// ── Bridges (active services) ─────────────────────────────────────────

/** @type {Map<string, BridgeService>} */
const activeBridges = new Map();
/** @type {Map<string, AbortController>} */
const pollingControllers = new Map();

// ── User-level SSE stream (push-based webhook delivery) ──────────────
//
// Session-mode only: /api/me/stream requires a Better-Auth cookie. When
// connected, the relay pushes webhook / response / claim frames the
// moment they land, so localhost forwarding starts within ~ms of the
// upstream provider's POST. Polling stays as catch-up.

/** @type {AbortController|null} */
let userStreamController = null;
/** Reconnect backoff in ms; grows on consecutive failures. */
let userStreamBackoffMs = 1000;
/** True between the "connected" frame and stream teardown. */
let userStreamConnected = false;

/**
 * @typedef {Object} BridgeService
 * @property {string} id
 * @property {string} name
 * @property {number} port
 * @property {string} path
 * @property {string} channelId
 * @property {boolean} active
 * @property {string} createdAt
 * @property {"connected"|"disconnected"|"error"|"limit"} status
 * @property {string|null} error
 * @property {number} eventCount
 * @property {number} errorCount
 */

// ── IndexedDB (per-channel ECDSA private keys) ───────────────────────

const IDB_NAME = "bridgehook";
const IDB_VERSION = 1;
const IDB_STORE = "channel-keys";
let dbPromise = null;

function openDB() {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(IDB_NAME, IDB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
	});
	dbPromise.catch(() => {
		dbPromise = null;
	});
	return dbPromise;
}
function tx(mode) {
	return openDB().then((db) => db.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
}
function idbWrap(req) {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
	});
}
async function idbGet(key) {
	return idbWrap((await tx("readonly")).get(key));
}
async function idbPut(key, value) {
	await idbWrap((await tx("readwrite")).put(value, key));
}
async function idbDelete(key) {
	await idbWrap((await tx("readwrite")).delete(key));
}

// ── Crypto helpers ───────────────────────────────────────────────────

const KEY_ALG = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_ALG = { name: "ECDSA", hash: "SHA-256" };

function toHex(buf) {
	const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let out = "";
	for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
	return out;
}

async function sha256Hex(input) {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return toHex(buf);
}

const keyRecord = (channelId) => `channel-key:${channelId}`;

async function generateChannelKey(channelId) {
	const pair = await crypto.subtle.generateKey(KEY_ALG, true, ["sign", "verify"]);
	const pubRaw = await crypto.subtle.exportKey("raw", pair.publicKey);
	const publicKeyHex = toHex(pubRaw);
	const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
	const nonExtractable = await crypto.subtle.importKey("pkcs8", pkcs8, KEY_ALG, false, ["sign"]);
	new Uint8Array(pkcs8).fill(0);
	await idbPut(keyRecord(channelId), { privateKey: nonExtractable, publicKeyHex });
	return publicKeyHex;
}

async function getChannelPrivateKey(channelId) {
	const rec = await idbGet(keyRecord(channelId));
	return rec?.privateKey ?? null;
}

async function deleteChannelKey(channelId) {
	try {
		await idbDelete(keyRecord(channelId));
	} catch {
		/* best-effort */
	}
}

async function signedFetch(channelId, url, init = {}) {
	const privateKey = await getChannelPrivateKey(channelId);
	if (!privateKey) throw new Error(`No signing key for channel ${channelId}`);
	const method = (init.method ?? "GET").toUpperCase();
	const pathname = new URL(url).pathname;
	const timestamp = Date.now().toString();
	const bodyStr = typeof init.body === "string" ? init.body : "";
	const canonical = `${method}\n${pathname}\n${timestamp}\n${await sha256Hex(bodyStr)}`;
	const sig = await crypto.subtle.sign(SIGN_ALG, privateKey, new TextEncoder().encode(canonical));
	const headers = new Headers(init.headers);
	headers.set("X-BH-Timestamp", timestamp);
	headers.set("X-BH-Signature", toHex(sig));
	return fetch(url, { ...init, headers });
}

// ── Relay API ────────────────────────────────────────────────────────

/**
 * Look up the user's existing channel for a given local port, or null
 * if there isn't one (or we're not signed in). Drives the stable
 * webhook URL UX — calling createChannel(3000) the second time should
 * give back the same URL the user already pasted into Stripe.
 */
async function findChannelByPort(port) {
	try {
		const init = await withAuth({ method: "GET" });
		const res = await fetch(`${RELAY_URL}/api/me/channels`, init);
		if (!res.ok) return null;
		const data = await res.json();
		const list = Array.isArray(data?.channels) ? data.channels : [];
		return list.find((c) => Number(c.port) === Number(port)) ?? null;
	} catch {
		return null;
	}
}

/**
 * Re-key an existing channel — used when we own a channel server-side
 * but lost the IndexedDB private key (cleared storage, fresh install,
 * different browser profile). Generates a new keypair, persists
 * locally, and POSTs the public half to /rotate-key. Same channel id,
 * same webhook URL, fresh signing material.
 */
async function rotateChannelKey(channelId) {
	const publicKey = await generateChannelKey(channelId);
	try {
		const init = await withAuth({
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ publicKey }),
		});
		const res = await fetch(
			`${RELAY_URL}/api/me/channels/${encodeURIComponent(channelId)}/rotate-key`,
			init,
		);
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`Rotate-key failed (${res.status})${text ? `: ${text}` : ""}`);
		}
	} catch (err) {
		await deleteChannelKey(channelId);
		throw err;
	}
}

async function createChannel(port, path) {
	// Stable URL: if the user is signed in and already has a channel for
	// this port, reuse it instead of minting fresh. Anonymous callers
	// (signed out, self-host) skip the lookup and get a new channel each
	// time — same legacy behavior as before.
	if (account.source !== null) {
		const existing = await findChannelByPort(port);
		if (existing) {
			const hasKey = !!(await getChannelPrivateKey(existing.id));
			if (!hasKey) await rotateChannelKey(existing.id);
			return {
				channelId: existing.id,
				port: existing.port,
				webhookUrl: existing.webhookUrl,
				expiresAt: existing.expiresAt ?? null,
			};
		}
	}

	const tempId = `pending-${crypto.randomUUID()}`;
	const publicKey = await generateChannelKey(tempId);
	try {
		const init = await withAuth({
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ publicKey, port, allowedPaths: [path] }),
		});
		const res = await fetch(`${RELAY_URL}/api/channels`, init);
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`Relay returned ${res.status}${text ? ` — ${text}` : ""}`);
		}
		const data = await res.json();
		const rec = await idbGet(keyRecord(tempId));
		if (rec) {
			await idbPut(keyRecord(data.channelId), rec);
			await idbDelete(keyRecord(tempId));
		}
		return data;
	} catch (err) {
		await deleteChannelKey(tempId);
		throw err;
	}
}

/**
 * One page of the channel's delivery queue: events no executor has answered
 * yet, oldest first. Returns `{ events, nextCursor }`.
 *
 * Relays that predate `?pending=1` answer with a plain newest-first array;
 * that is normalised here (filtered to unanswered, sorted oldest-first) so
 * the extension still works against an older self-hosted relay.
 */
async function fetchPendingPage(channelId, after = null) {
	const qs = new URLSearchParams({ pending: "1", limit: String(PENDING_PAGE_SIZE) });
	if (after) qs.set("after", after);
	const url = `${RELAY_URL}/api/channels/${channelId}/events?${qs}`;
	const res = await signedFetch(channelId, url);
	if (!res.ok) {
		// 402 with code:"quota" is a soft signal — we want to render it
		// distinctly from real errors. Bubble up structured info so the
		// poll loop can flip status to "limit" rather than "error".
		if (res.status === 402) {
			const body = await res.json().catch(() => ({}));
			if (body?.code === "quota") {
				const err = new Error(body.error || "Daily webhook cap reached");
				err.kind = "quota";
				throw err;
			}
		}
		throw new Error(`Failed to get events: ${res.status}`);
	}
	const data = await res.json();
	if (Array.isArray(data)) {
		const events = data
			.filter((e) => e.responseStatus == null && !e.error)
			.sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));
		return { events, nextCursor: null };
	}
	return {
		events: Array.isArray(data?.events) ? data.events : [],
		nextCursor: typeof data?.nextCursor === "string" ? data.nextCursor : null,
	};
}

/**
 * Persistent id for this extension install, used as the claim owner so a
 * webhook is forwarded by exactly one executor even when the dashboard tab or
 * a paired desktop app is connected to the same channel.
 */
const EXECUTOR_ID_KEY = "bridgehook:executor-id";
let cachedExecutorId = null;

async function getExecutorId() {
	if (cachedExecutorId) return cachedExecutorId;
	const out = await chrome.storage.local.get([EXECUTOR_ID_KEY]);
	let id = out[EXECUTOR_ID_KEY];
	if (typeof id !== "string" || !id) {
		id = `ext_${crypto.randomUUID().replace(/-/g, "")}`;
		await chrome.storage.local.set({ [EXECUTOR_ID_KEY]: id });
	}
	cachedExecutorId = id;
	return id;
}

/**
 * Claim an event before forwarding it. Returns true when this install owns
 * it, including a claim it made earlier and has not yet answered (a retry
 * after localhost was down), false when another executor got there first.
 */
async function claimEvent(channelId, eventId) {
	const clientId = await getExecutorId();
	const res = await signedFetch(channelId, `${RELAY_URL}/hook/${channelId}/claim`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ eventId, clientId }),
	});
	if (res.ok) return true;
	if (res.status === 409) {
		const data = await res.json().catch(() => ({}));
		return data?.claimerId === clientId;
	}
	if (res.status === 404) return false; // event aged out or channel deleted
	throw new Error(`claim failed: ${res.status}`);
}

async function sendResponseToRelay(channelId, eventId, response) {
	const device = await getStoredDeviceToken();
	const body = JSON.stringify({
		eventId,
		status: response.status,
		headers: response.headers,
		body: response.body,
		latencyMs: response.latencyMs,
		deviceId: device?.deviceId,
	});
	await signedFetch(channelId, `${RELAY_URL}/hook/${channelId}/response`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
	});
}

// ── Sign-in handoff ──────────────────────────────────────────────────
//
// "Sign in" opens the dashboard's login page in a new tab. When the user
// completes sign-up there, the relay's session cookie is set on the
// extension's side too (same workers.dev host, SameSite=None). We then
// re-probe /api/me to pick up the session — the popup runs that probe
// on focus / open so no explicit handoff is needed.

function openDashboardLogin() {
	chrome.tabs.create({ url: `${WEB_URL}/login` });
}
function openDashboardSignup() {
	chrome.tabs.create({ url: `${WEB_URL}/login?signup=1` });
}

// ── Self-register as a device (session-authed shortcut) ──────────────
//
// Called when the cookie probe in refreshAccount() succeeds but no
// device token is stored locally. The relay's session is the proof of
// identity, so no pairing code is involved — we POST to
// /api/me/devices/self-register and the server mints a token plus
// inserts a `devices` row. Result: the dashboard's Devices list
// immediately shows this browser without a second user action.

async function selfRegisterDevice() {
	const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "Browser";
	const browser = /Chrome/i.test(ua) ? "Chrome" : /Firefox/i.test(ua) ? "Firefox" : "Browser";
	const os = /Mac OS X/i.test(ua)
		? "macOS"
		: /Windows/i.test(ua)
			? "Windows"
			: /Linux/i.test(ua)
				? "Linux"
				: "Unknown OS";
	const label = `${browser} on ${os}`;

	const res = await fetch(`${RELAY_URL}/api/me/devices/self-register`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ kind: "extension", label, userAgent: ua }),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`self-register failed (${res.status})${text ? `: ${text}` : ""}`);
	}
	const minted = await res.json();
	if (!minted.token || !minted.deviceId) {
		throw new Error("self-register returned malformed payload");
	}
	await storeDeviceToken({
		token: minted.token,
		deviceId: minted.deviceId,
		userId: minted.userId,
		label: minted.label || label,
		kind: minted.kind || "extension",
		connectedAt: new Date().toISOString(),
	});
	console.log(`[BridgeHook] Self-registered as ${minted.deviceId} (${minted.label})`);
	return minted;
}

// ── Device-token pair flow (kept for "stay paired after sign-out" use case) ──

async function connectDevice() {
	const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "Browser";
	const browser = /Chrome/i.test(ua) ? "Chrome" : /Firefox/i.test(ua) ? "Firefox" : "Browser";
	const os = /Mac OS X/i.test(ua)
		? "macOS"
		: /Windows/i.test(ua)
			? "Windows"
			: /Linux/i.test(ua)
				? "Linux"
				: "Unknown OS";
	const labelHint = `${browser} on ${os}`;

	const startRes = await fetch(`${RELAY_URL}/auth/device/start`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ kind: "extension", labelHint, userAgent: ua }),
	});
	if (!startRes.ok) {
		const text = await startRes.text().catch(() => "");
		throw new Error(`Device start failed (${startRes.status})${text ? `: ${text}` : ""}`);
	}
	const { deviceCode, verificationUrl, pollInterval, expiresIn } = await startRes.json();

	chrome.tabs.create({ url: verificationUrl });

	const intervalMs = Math.max(2000, Number(pollInterval) * 1000 || 5000);
	const deadline = Date.now() + Math.max(60_000, Number(expiresIn) * 1000 || 900_000);

	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, intervalMs));
		const exRes = await fetch(`${RELAY_URL}/auth/device/exchange`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: deviceCode }),
		});
		if (exRes.status === 410) throw new Error("Pairing code expired or already used");
		if (exRes.status === 202) continue;
		if (!exRes.ok) {
			const text = await exRes.text().catch(() => "");
			throw new Error(`Device exchange failed (${exRes.status})${text ? `: ${text}` : ""}`);
		}
		const minted = await exRes.json();
		if (minted.token && minted.deviceId && minted.userId) {
			await storeDeviceToken({
				token: minted.token,
				deviceId: minted.deviceId,
				userId: minted.userId,
				label: minted.label || labelHint,
				kind: minted.kind || "extension",
				connectedAt: new Date().toISOString(),
			});
			await refreshAccount();
			return minted;
		}
	}
	throw new Error("Pairing timed out — try again");
}

async function disconnectDevice() {
	await clearDeviceToken();
	await refreshAccount();
}

// ── Forwarding (relay → localhost) ──────────────────────────────────

async function forwardToLocalhost(event, port, servicePath) {
	const start = performance.now();
	// The relay stores the path localhost should receive. Only rows written
	// before it did still carry the legacy `/hook/<thisChannelId>` prefix;
	// strip exactly that, never a real `/hook/...` route of the user's app.
	const legacyPrefix = event.channelId ? `/hook/${event.channelId}` : null;
	const rawPath = event.path || "";
	const eventPath =
		(legacyPrefix && (rawPath === legacyPrefix || rawPath.startsWith(`${legacyPrefix}/`))
			? rawPath.slice(legacyPrefix.length)
			: rawPath) ||
		servicePath ||
		"/";

	const rawHeaders =
		typeof event.requestHeaders === "string"
			? JSON.parse(event.requestHeaders || "{}")
			: event.headers || {};

	const skip = new Set([
		"host",
		"cf-ray",
		"cf-connecting-ip",
		"cf-ipcountry",
		"cf-visitor",
		"x-real-ip",
		"x-forwarded-proto",
		"x-forwarded-for",
		"connection",
		"accept-encoding",
		"transfer-encoding",
		"content-length",
	]);
	const headers = {};
	for (const [k, v] of Object.entries(rawHeaders)) {
		if (!skip.has(k.toLowerCase())) headers[k] = v;
	}

	const body = event.requestBody ?? event.body ?? undefined;
	const method = event.method || "POST";
	const url = `http://localhost:${port}${eventPath}`;

	try {
		const response = await fetch(url, {
			method,
			headers,
			body,
			signal: AbortSignal.timeout(LOCALHOST_TIMEOUT_MS),
		});
		const latencyMs = Math.round(performance.now() - start);
		const respBody = await response.text();
		const respHeaders = {};
		response.headers.forEach((v, k) => {
			respHeaders[k] = v;
		});
		return {
			status: response.status,
			headers: respHeaders,
			body: respBody,
			latencyMs,
			error: null,
		};
	} catch (err) {
		const latencyMs = Math.round(performance.now() - start);
		const msg =
			err?.name === "TimeoutError"
				? `localhost:${port} did not respond within ${LOCALHOST_TIMEOUT_MS / 60000} minutes.`
				: err.message?.includes("Failed to fetch")
					? `Connection refused — is localhost:${port} running?`
					: err.message;
		return { status: 0, headers: {}, body: "", latencyMs, error: msg };
	}
}

// ── User stream (SSE) ───────────────────────────────────────────────

function handleUserStreamFrame(frame) {
	if (!frame || typeof frame !== "object") return;
	if (frame.type === "connected") {
		userStreamConnected = true;
		console.log("[BridgeHook] user stream connected");
		return;
	}
	if (frame.type !== "webhook" || !frame.id || !frame.channelId) return;

	let target = null;
	for (const service of activeBridges.values()) {
		if (service.channelId === frame.channelId && service.active) {
			target = service;
			break;
		}
	}
	if (!target) return;

	// Wake the ordered drain rather than forwarding the frame directly, so a
	// live webhook never overtakes older queued ones. See the bridge loop.
	target._wake?.();
}

/**
 * Open a streaming-fetch SSE connection to /api/me/stream. The relay
 * pushes webhook frames the moment they land, so localhost forwarding
 * is push-based when the user is signed in via dashboard cookie.
 *
 * Reconnects with exponential backoff up to 30s; stops cleanly when
 * the account loses session-mode or the SW tears down.
 */
async function startUserStream() {
	if (userStreamController) return;
	if (account.source !== "session") return;

	const controller = new AbortController();
	userStreamController = controller;

	try {
		const res = await fetch(`${RELAY_URL}/api/me/stream`, {
			method: "GET",
			credentials: "include",
			headers: { Accept: "text/event-stream" },
			signal: controller.signal,
		});
		if (!res.ok || !res.body) {
			throw new Error(`stream failed (${res.status})`);
		}
		userStreamBackoffMs = 1000;

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			while (true) {
				const idx = buffer.indexOf("\n\n");
				if (idx < 0) break;
				const frame = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				// SSE comment frames (": heartbeat") have no data line — skip.
				const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
				if (!dataLine) continue;
				try {
					handleUserStreamFrame(JSON.parse(dataLine.slice(6)));
				} catch (err) {
					console.warn("[BridgeHook] malformed SSE frame:", err);
				}
			}
		}
	} catch (err) {
		if (controller.signal.aborted) {
			// Intentional teardown; don't reconnect.
			return;
		}
		console.warn("[BridgeHook] user stream error:", err?.message ?? err);
	} finally {
		if (userStreamController === controller) {
			userStreamController = null;
		}
		userStreamConnected = false;
	}

	// Reconnect path — fires only if we got here without an explicit abort.
	const delay = userStreamBackoffMs;
	userStreamBackoffMs = Math.min(userStreamBackoffMs * 2, 30_000);
	setTimeout(() => {
		if (account.source === "session" && !userStreamController) {
			startUserStream().catch((err) => {
				console.warn("[BridgeHook] stream reconnect failed:", err);
			});
		}
	}, delay);
}

function stopUserStream() {
	if (userStreamController) {
		userStreamController.abort();
		userStreamController = null;
	}
	userStreamConnected = false;
}

// ── Bridge loop (ordered queue drain, woken by SSE, backed by polling) ──
//
// Every service forwards through one serialized drain of the channel's
// delivery queue (`GET /api/channels/:id/events?pending=1`, oldest first):
//
//   • On start — including when the browser opens after being closed — the
//     drain walks the whole backlog page by page, so webhooks that arrived
//     while nobody was listening are delivered, in arrival order.
//   • Live — an SSE frame from /api/me/stream does not forward directly; it
//     wakes the drain. That keeps one ordered path for live and backlog
//     events alike, so a fresh webhook can never overtake an older one.
//   • Fallback — a timer re-runs the drain (2s without SSE, 15s with it).
//
// Each event is claimed before forwarding, so with several executors on one
// channel (extension, dashboard tab, desktop app) exactly one forwards it.
// The claim is refreshed every CLAIM_HEARTBEAT_MS while localhost works on
// it, so a slow handler (or one paused on a breakpoint) is not handed to a
// second executor by the relay's 60s stale-claim takeover.
//
// When forwarding fails the drain stops at that event, so nothing later is
// delivered ahead of it:
//   • localhost down (a liveness probe fails): wait and retry; outages do
//     not count against the event, however long they last
//   • localhost up but this event keeps failing: after MAX_FORWARD_ATTEMPTS
//     the failure is recorded on the relay (status 0) and the drain moves on,
//     so one payload that crashes the handler cannot hold the queue forever

const MAX_FORWARD_ATTEMPTS = 3;
const CLAIM_HEARTBEAT_MS = 20000;

/** True when something is listening on localhost:<port> (any HTTP answer). */
async function localhostReachable(port) {
	try {
		await fetch(`http://localhost:${port}/`, {
			method: "HEAD",
			signal: AbortSignal.timeout(3000),
		});
		return true;
	} catch {
		return false;
	}
}

function noteLocalhostDown(service, message) {
	if (!service._localhostDown) {
		service._localhostDown = true;
		chrome.notifications.create({
			type: "basic",
			iconUrl: "icons/icon-128.png",
			title: "BridgeHook",
			message: `${service.name}: ${message} Webhooks are queued and will be delivered when it is back.`,
		});
	}
	service.status = "error";
	service.error = message;
	broadcastStatus();
}

/**
 * Forward one queued event. Returns:
 *   "done"        — answered (forwarded, or given up on and recorded)
 *   "skipped"     — another executor holds it right now, or already handled
 *   "retry-later" — leave it queued and stop this pass
 */
async function forwardEventThroughBridge(service, evt) {
	if (!service.active) return "skipped";
	if (!service._handled) service._handled = new Set();
	if (!service._attempts) service._attempts = new Map();
	if (service._handled.has(evt.id)) return "skipped";

	const attempts = service._attempts.get(evt.id) ?? 0;
	// On a retry, check the server is up before re-sending: an outage should
	// not burn the event's attempts, and nothing should be sent into it.
	if (attempts > 0 || service._localhostDown) {
		if (!(await localhostReachable(service.port))) {
			noteLocalhostDown(service, `Connection refused — is localhost:${service.port} running?`);
			return "retry-later";
		}
	}

	// Not added to _handled when another executor holds it: if that claim goes
	// stale (tab closed, its forward failed) a later pass takes it over.
	if (!(await claimEvent(service.channelId, evt.id))) return "skipped";

	const heartbeat = setInterval(() => {
		claimEvent(service.channelId, evt.id).catch(() => {});
	}, CLAIM_HEARTBEAT_MS);
	let result;
	try {
		result = await forwardToLocalhost(evt, service.port, service.path);
	} finally {
		clearInterval(heartbeat);
	}

	if (result.error) {
		if (!(await localhostReachable(service.port))) {
			noteLocalhostDown(service, result.error);
			return "retry-later";
		}
		const tries = attempts + 1;
		if (tries < MAX_FORWARD_ATTEMPTS) {
			service._attempts.set(evt.id, tries);
			service.status = "error";
			service.error = `${result.error} (attempt ${tries} of ${MAX_FORWARD_ATTEMPTS})`;
			broadcastStatus();
			return "retry-later";
		}
		// Localhost is up but this event fails every time: record it and move
		// on rather than block every newer webhook behind it.
		service._attempts.delete(evt.id);
		service._handled.add(evt.id);
		service.errorCount = (service.errorCount || 0) + 1;
		chrome.notifications.create({
			type: "basic",
			iconUrl: "icons/icon-128.png",
			title: "BridgeHook",
			message: `${service.name}: a ${evt.method || "POST"} ${evt.path || "/"} webhook failed ${MAX_FORWARD_ATTEMPTS} times while localhost:${service.port} was up; skipped it. Replay it from the dashboard.`,
		});
		try {
			await sendResponseToRelay(service.channelId, evt.id, {
				status: 0,
				headers: {},
				body: `BridgeHook: forwarding failed ${MAX_FORWARD_ATTEMPTS} times while localhost:${service.port} was reachable. Last error: ${result.error}`,
				latencyMs: result.latencyMs,
			});
		} catch (err) {
			console.warn(`[BridgeHook] failure upload failed for ${evt.id}:`, err);
		}
		broadcastStatus();
		return "done";
	}

	service._localhostDown = false;
	service._attempts.delete(evt.id);
	service._handled.add(evt.id);
	service.eventCount = (service.eventCount || 0) + 1;
	if (result.status >= 400) service.errorCount = (service.errorCount || 0) + 1;
	try {
		await sendResponseToRelay(service.channelId, evt.id, result);
	} catch (err) {
		console.warn(`[BridgeHook] response upload failed for ${evt.id}:`, err);
	}
	broadcastStatus();
	return "done";
}

/**
 * Walk the delivery queue oldest-first until it is empty, localhost is down,
 * or the bridge is stopped. Returns false when it stopped on a localhost
 * failure.
 */
async function drainQueue(service, signal) {
	let after = null;
	do {
		if (signal.aborted) return true;
		const page = await fetchPendingPage(service.channelId, after);
		for (const evt of page.events) {
			if (signal.aborted) return true;
			if ((await forwardEventThroughBridge(service, evt)) === "retry-later") return false;
		}
		after = page.nextCursor;
	} while (after);
	return true;
}

function startBridge(service) {
	if (pollingControllers.has(service.id)) stopBridge(service.id);

	const controller = new AbortController();
	pollingControllers.set(service.id, controller);

	if (!service._handled) service._handled = new Set();
	let consecutiveErrors = 0;
	let running = false;
	let wakeAgain = false;
	let timer = null;

	async function run() {
		if (controller.signal.aborted) return;
		if (running) {
			wakeAgain = true; // an SSE frame arrived mid-drain; go round again
			return;
		}
		running = true;
		clearTimeout(timer);
		let localhostOk = true;
		try {
			do {
				wakeAgain = false;
				localhostOk = await drainQueue(service, controller.signal);
			} while (wakeAgain && localhostOk && !controller.signal.aborted);
			consecutiveErrors = 0;
			if (localhostOk) {
				service.status = "connected";
				service.error = null;
			}
			broadcastStatus();
		} catch (err) {
			consecutiveErrors++;
			service.status = err?.kind === "quota" ? "limit" : "error";
			service.error = err.message;
			broadcastStatus();
		} finally {
			running = false;
		}
		if (controller.signal.aborted) return;
		// quota: 30s, nothing will change before the reset.
		// localhost down: retry the queued event every 5s.
		// relay errors: back off to 10s.
		// SSE healthy: 15s safety net; SSE frames wake the drain instantly.
		const delay =
			service.status === "limit"
				? 30000
				: !localhostOk
					? 5000
					: consecutiveErrors > 3
						? 10000
						: userStreamConnected
							? 15000
							: 2000;
		timer = setTimeout(run, delay);
	}

	service._wake = run;
	controller.signal.addEventListener("abort", () => clearTimeout(timer));
	run();
}

function stopBridge(serviceId) {
	const controller = pollingControllers.get(serviceId);
	if (controller) {
		controller.abort();
		pollingControllers.delete(serviceId);
	}
	const service = activeBridges.get(serviceId);
	if (service) {
		service.status = "disconnected";
		service.error = null;
		service._wake = null;
	}
}
// ── Storage / CRUD ───────────────────────────────────────────────────

async function loadServices() {
	const out = await chrome.storage.local.get(SERVICES_KEY);
	return out[SERVICES_KEY] || [];
}
async function saveServices(services) {
	await chrome.storage.local.set({ [SERVICES_KEY]: services });
}

async function addService(name, port, path) {
	const created = await createChannel(port, path);
	const service = {
		id: crypto.randomUUID(),
		name,
		port,
		path,
		channelId: created.channelId,
		active: true,
		createdAt: new Date().toISOString(),
		status: "disconnected",
		error: null,
		eventCount: 0,
		errorCount: 0,
	};
	const services = await loadServices();
	services.push(service);
	await saveServices(services);
	activeBridges.set(service.id, service);
	startBridge(service);
	return { service, webhookUrl: created.webhookUrl || `${RELAY_URL}/${created.channelId}` };
}

async function removeService(serviceId) {
	stopBridge(serviceId);
	const service = activeBridges.get(serviceId);
	if (service?.channelId) await deleteChannelKey(service.channelId);
	activeBridges.delete(serviceId);
	const services = await loadServices();
	await saveServices(services.filter((s) => s.id !== serviceId));
}

async function toggleService(serviceId) {
	const services = await loadServices();
	const service = services.find((s) => s.id === serviceId);
	if (!service) return;
	service.active = !service.active;
	await saveServices(services);
	const bridge = activeBridges.get(serviceId);
	if (bridge) {
		bridge.active = service.active;
		if (service.active) startBridge(bridge);
		else stopBridge(serviceId);
	}
	broadcastStatus();
	return service.active;
}

// ── Broadcasting ─────────────────────────────────────────────────────

function serializeService(s) {
	return {
		id: s.id,
		name: s.name,
		port: s.port,
		path: s.path,
		channelId: s.channelId,
		active: s.active,
		status: s.status,
		error: s.error,
		eventCount: s.eventCount || 0,
		errorCount: s.errorCount || 0,
		webhookUrl: `${RELAY_URL}/${s.channelId}`,
	};
}

function broadcastStatus() {
	const services = Array.from(activeBridges.values()).map(serializeService);
	const limitCount = services.filter((s) => s.active && s.status === "limit").length;
	const activeCount = services.filter((s) => s.active && s.status === "connected").length;
	const errorCount = services.reduce((sum, s) => sum + (s.errorCount || 0), 0);

	if (limitCount > 0) {
		chrome.action.setBadgeBackgroundColor({ color: "#fbbf24" });
		chrome.action.setBadgeText({ text: "!" });
	} else if (errorCount > 0) {
		chrome.action.setBadgeBackgroundColor({ color: "#f87171" });
		chrome.action.setBadgeText({ text: String(errorCount) });
	} else if (activeCount > 0) {
		chrome.action.setBadgeBackgroundColor({ color: "#4ade80" });
		chrome.action.setBadgeText({ text: String(activeCount) });
	} else {
		chrome.action.setBadgeText({ text: "" });
	}

	chrome.runtime.sendMessage({ type: "status", services, account }).catch(() => {});
}

// ── Auto-detect local servers ────────────────────────────────────────

const COMMON_PORTS = [3000, 3001, 4000, 5000, 5173, 8000, 8080, 8888];

async function probePort(port) {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 1500);
		const res = await fetch(`http://localhost:${port}/`, {
			method: "HEAD",
			signal: controller.signal,
		});
		clearTimeout(timeout);
		const serverHeader = res.headers.get("server") || res.headers.get("x-powered-by") || null;
		return { port, alive: true, status: res.status, server: serverHeader };
	} catch {
		return { port, alive: false, status: 0, server: null };
	}
}
async function scanPorts() {
	const results = await Promise.all(COMMON_PORTS.map(probePort));
	return results.filter((r) => r.alive);
}

// ── Message handlers ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	(async () => {
		switch (msg.type) {
			case "get_status": {
				const services = Array.from(activeBridges.values()).map(serializeService);
				sendResponse({ services, account });
				break;
			}
			case "refresh_account": {
				await refreshAccount();
				sendResponse({ account });
				break;
			}
			case "open_login": {
				openDashboardLogin();
				sendResponse({ ok: true });
				break;
			}
			case "open_signup": {
				openDashboardSignup();
				sendResponse({ ok: true });
				break;
			}
			case "open_dashboard": {
				chrome.tabs.create({ url: `${WEB_URL}/dashboard` });
				sendResponse({ ok: true });
				break;
			}
			case "connect_device": {
				try {
					const minted = await connectDevice();
					sendResponse({ ok: true, deviceId: minted.deviceId, label: minted.label });
				} catch (err) {
					sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
				}
				break;
			}
			case "disconnect_device": {
				await disconnectDevice();
				sendResponse({ ok: true });
				break;
			}
			case "add_service": {
				try {
					const { service, webhookUrl } = await addService(msg.name, msg.port, msg.path);
					sendResponse({ ok: true, service: { ...service, webhookUrl } });
				} catch (err) {
					sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
				}
				break;
			}
			case "remove_service": {
				await removeService(msg.serviceId);
				sendResponse({ ok: true });
				broadcastStatus();
				break;
			}
			case "toggle_service": {
				const active = await toggleService(msg.serviceId);
				sendResponse({ ok: true, active });
				break;
			}
			case "scan_ports": {
				const alive = await scanPorts();
				sendResponse({ ports: alive });
				break;
			}
			default:
				sendResponse({ error: "Unknown message type" });
		}
	})();
	return true;
});

// ── SW resilience: alarms + rehydrate on wake ────────────────────────

const HEARTBEAT_ALARM = "bh-heartbeat";

async function ensurePollingForActiveServices() {
	for (const service of activeBridges.values()) {
		if (service.active && !pollingControllers.has(service.id)) {
			startBridge(service);
		}
	}
}

async function rehydrate() {
	const services = await loadServices();
	for (const service of services) {
		const hasKey = !!(await getChannelPrivateKey(service.channelId));
		if (!hasKey) {
			console.warn(`[BridgeHook] No signing key for "${service.name}" — skipping`);
			continue;
		}
		service.status = service.active ? "disconnected" : "disconnected";
		service.error = null;
		activeBridges.set(service.id, service);
	}
	await refreshAccount();
	await ensurePollingForActiveServices();
	broadcastStatus();
}

chrome.runtime.onInstalled.addListener(async () => {
	await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
	await rehydrate();
});

chrome.runtime.onStartup.addListener(async () => {
	await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
	await rehydrate();
});

// Fires every 30s — MV3 minimum. The alarm wakes the SW; we re-attach
// polling for any active service whose in-tick loop died with the SW.
// Account state is also refreshed so the popup's identity chip stays
// in sync when the user signs in/out on the dashboard. The user-level
// SSE stream is also restarted if it died with the SW.
chrome.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name !== HEARTBEAT_ALARM) return;
	if (activeBridges.size === 0) {
		await rehydrate();
	} else {
		await refreshAccount();
		await ensurePollingForActiveServices();
		if (account.source === "session" && !userStreamController) {
			startUserStream().catch((err) => {
				console.warn("[BridgeHook] start stream failed:", err);
			});
		}
		broadcastStatus();
	}
});

// SW boot — fires on first install, version update, and every cold wake.
rehydrate();
