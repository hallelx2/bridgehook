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

const RELAY_URL = "https://bridgehook-relay.halleluyaholudele.workers.dev";
const WEB_URL = "https://bridgehook-web.pages.dev";

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

async function fetchEvents(channelId, limit = 50) {
	const url = `${RELAY_URL}/api/channels/${channelId}/events?limit=${limit}`;
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
	return res.json();
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
	const eventPath = event.path?.replace(/^\/hook\/[a-z0-9]+/, "") || servicePath || "/";

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
		const response = await fetch(url, { method, headers, body });
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
		const msg = err.message?.includes("Failed to fetch")
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

	const headers = frame.headers && typeof frame.headers === "object" ? frame.headers : {};
	const eventLike = {
		id: frame.id,
		channelId: frame.channelId,
		method: frame.method || "POST",
		path: frame.path || "/",
		requestHeaders: JSON.stringify(headers),
		requestBody: typeof frame.body === "string" ? frame.body : "",
		headers,
		body: typeof frame.body === "string" ? frame.body : "",
	};
	forwardEventThroughBridge(target, eventLike).catch((err) => {
		console.warn("[BridgeHook] stream forward failed:", err);
	});
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

// ── Bridge loop (per-service polling + SSE-driven push) ─────────────
//
// Two paths feed the same handler:
//   1. SSE — the user-level /api/me/stream pushes webhook frames to
//      handleUserStreamFrame() the moment they land.
//   2. Polling — the per-service loop below still calls fetchEvents()
//      as a catch-up / fallback. When SSE is healthy we extend the
//      polling delay; when SSE is down (self-host, device-token auth,
//      transient errors) polling drops back to its old 2s cadence.
//
// `service._handled` is a Set shared across both paths so an event
// pushed via SSE is filtered out of the next polling pass even though
// the relay's responseStatus hasn't landed yet.

async function forwardEventThroughBridge(service, evt) {
	if (!service.active) return;
	if (!service._handled) service._handled = new Set();
	if (service._handled.has(evt.id)) return;
	service._handled.add(evt.id);

	service.eventCount = (service.eventCount || 0) + 1;
	broadcastStatus();

	const result = await forwardToLocalhost(evt, service.port, service.path);
	if (result.error) {
		service.errorCount = (service.errorCount || 0) + 1;
		chrome.notifications.create({
			type: "basic",
			iconUrl: "icons/icon-128.png",
			title: "BridgeHook",
			message: `${service.name}: ${result.error}`,
		});
	} else {
		try {
			await sendResponseToRelay(service.channelId, evt.id, result);
		} catch (err) {
			console.warn(`[BridgeHook] response upload failed for ${evt.id}:`, err);
		}
		if (result.status >= 400) {
			service.errorCount = (service.errorCount || 0) + 1;
		}
	}
	broadcastStatus();
}

function startBridge(service) {
	if (pollingControllers.has(service.id)) stopBridge(service.id);

	const controller = new AbortController();
	pollingControllers.set(service.id, controller);

	if (!service._handled) service._handled = new Set();
	let consecutiveErrors = 0;

	async function poll() {
		if (controller.signal.aborted) return;
		try {
			const events = await fetchEvents(service.channelId);
			consecutiveErrors = 0;
			service.status = "connected";
			service.error = null;
			broadcastStatus();

			const unforwarded = events.filter(
				(e) => !e.responseStatus && !e.error && !service._handled.has(e.id),
			);
			for (const evt of unforwarded) {
				await forwardEventThroughBridge(service, evt);
			}
		} catch (err) {
			consecutiveErrors++;
			if (err?.kind === "quota") {
				service.status = "limit";
				service.error = err.message;
			} else {
				service.status = "error";
				service.error = err.message;
			}
			broadcastStatus();
		}
		if (!controller.signal.aborted) {
			// quota: poll slowly (30s) — keeps the SW responsive but doesn't
			// burn through nothing waiting for tomorrow's reset.
			// SSE healthy: drop to 15s — SSE is the live path; this is
			// just catch-up for events we might have missed during a
			// reconnect window.
			const delay =
				service.status === "limit"
					? 30000
					: consecutiveErrors > 3
						? 10000
						: userStreamConnected
							? 15000
							: 2000;
			setTimeout(poll, delay);
		}
	}
	poll();
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
	return { service, webhookUrl: created.webhookUrl || `${RELAY_URL}/hook/${created.channelId}` };
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
		webhookUrl: `${RELAY_URL}/hook/${s.channelId}`,
	};
}

function broadcastStatus() {
	const services = Array.from(activeBridges.values()).map(serializeService);
	const limitCount = services.filter((s) => s.active && s.status === "limit").length;
	const activeCount = services.filter((s) => s.active && s.status === "connected").length;
	const errorCount = services.reduce((sum, s) => sum + (s.errorCount || 0), 0);

	if (limitCount > 0) {
		chrome.action.setBadgeBackgroundColor({ color: "#F59E0B" });
		chrome.action.setBadgeText({ text: "!" });
	} else if (errorCount > 0) {
		chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
		chrome.action.setBadgeText({ text: String(errorCount) });
	} else if (activeCount > 0) {
		chrome.action.setBadgeBackgroundColor({ color: "#22C55E" });
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
