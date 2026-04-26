/**
 * BridgeHook Extension — Background Service Worker
 *
 * This replaces the browser tab as the bridge between the relay server
 * and localhost. Unlike a web page, extensions are exempt from CORS and
 * mixed content restrictions, so forwarding from HTTPS relay to HTTP
 * localhost works perfectly.
 *
 * Auth model (matches the web client):
 *   - On channel create, we generate an ECDSA P-256 keypair via crypto.subtle.
 *   - The public key is sent to the relay.
 *   - The private key is re-imported as non-extractable and stored in IndexedDB.
 *     From that point on `crypto.subtle.exportKey()` will throw — no JS
 *     (including ours) can read its raw bytes.
 *   - Every authenticated relay request is signed:
 *         sig = ECDSA(key, "METHOD\nPATH\nTIMESTAMP\nSHA256(body)")
 *
 * Architecture:
 *   Relay (HTTPS) → polling → Extension background.js → fetch → localhost (HTTP)
 *   localhost response → Extension → POST (signed) → Relay
 */

const RELAY_URL = "https://bridgehook-relay.halleluyaholudele.workers.dev";

// ── State ────────────────────────────────────────────────────────────

/** @type {Map<string, BridgeService>} Active bridges keyed by service ID */
const activeBridges = new Map();

/** @type {Map<string, AbortController>} Abort controllers for polling loops */
const pollingControllers = new Map();

/**
 * @typedef {Object} BridgeService
 * @property {string} id
 * @property {string} name
 * @property {number} port
 * @property {string} path
 * @property {string} channelId
 * @property {boolean} active
 * @property {string} createdAt
 * @property {"connected"|"disconnected"|"error"} status
 * @property {string|null} error
 * @property {number} eventCount
 * @property {number} errorCount
 */

// ── IndexedDB (CryptoKey storage) ────────────────────────────────────

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
		req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
	});
}

async function idbGet(key) {
	const store = await tx("readonly");
	return idbWrap(store.get(key));
}
async function idbPut(key, value) {
	const store = await tx("readwrite");
	await idbWrap(store.put(value, key));
}
async function idbDelete(key) {
	const store = await tx("readwrite");
	await idbWrap(store.delete(key));
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

/**
 * Generate a fresh keypair for the channel. Returns the hex-encoded raw
 * public key. The non-extractable private key is persisted in IndexedDB.
 */
async function generateChannelKey(channelId) {
	const pair = await crypto.subtle.generateKey(KEY_ALG, true, ["sign", "verify"]);
	const pubRaw = await crypto.subtle.exportKey("raw", pair.publicKey);
	const publicKeyHex = toHex(pubRaw);

	// Re-import as non-extractable. From now on no script can export the bytes.
	const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
	const nonExtractable = await crypto.subtle.importKey("pkcs8", pkcs8, KEY_ALG, false, ["sign"]);
	new Uint8Array(pkcs8).fill(0);

	await idbPut(keyRecord(channelId), {
		privateKey: nonExtractable,
		publicKeyHex,
	});
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

/**
 * Sign and send an authenticated request. Adds X-BH-Timestamp + X-BH-Signature.
 */
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

async function createChannel(port, path) {
	// Generate into a temporary slot — we don't know the channel id until the
	// server responds. On success we move the IDB record into place.
	const tempId = `pending-${crypto.randomUUID()}`;
	const publicKey = await generateChannelKey(tempId);

	try {
		const res = await fetch(`${RELAY_URL}/api/channels`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ publicKey, port, allowedPaths: [path] }),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`Relay returned ${res.status}${text ? ` — ${text}` : ""}`);
		}
		const data = await res.json();
		// Move the key record from tempId → real channelId.
		const rec = await idbGet(keyRecord(tempId));
		if (rec) {
			await idbPut(keyRecord(data.channelId), rec);
			await idbDelete(keyRecord(tempId));
		}
		return data.channelId;
	} catch (err) {
		await deleteChannelKey(tempId);
		throw err;
	}
}

async function fetchEvents(channelId, limit = 50) {
	const url = `${RELAY_URL}/api/channels/${channelId}/events?limit=${limit}`;
	const res = await signedFetch(channelId, url);
	if (!res.ok) throw new Error(`Failed to get events: ${res.status}`);
	return res.json();
}

async function sendResponseToRelay(channelId, eventId, response) {
	const body = JSON.stringify({
		eventId,
		status: response.status,
		headers: response.headers,
		body: response.body,
		latencyMs: response.latencyMs,
	});
	await signedFetch(channelId, `${RELAY_URL}/hook/${channelId}/response`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
	});
}

// ── Forwarding ───────────────────────────────────────────────────────

/**
 * Forward a webhook event to localhost.
 * Extensions are exempt from CORS and mixed content — this just works.
 */
async function forwardToLocalhost(event, port, servicePath) {
	const start = performance.now();

	// Extract path: strip the /hook/channelId prefix
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

// ── Bridge Loop ──────────────────────────────────────────────────────

function startBridge(service) {
	if (pollingControllers.has(service.id)) {
		stopBridge(service.id);
	}

	const controller = new AbortController();
	pollingControllers.set(service.id, controller);

	const forwarded = new Set();
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
				(e) => !e.responseStatus && !e.error && !forwarded.has(e.id),
			);

			for (const evt of unforwarded) {
				forwarded.add(evt.id);
				service.eventCount = (service.eventCount || 0) + 1;

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
					await sendResponseToRelay(service.channelId, evt.id, result);
					if (result.status >= 400) {
						service.errorCount = (service.errorCount || 0) + 1;
						chrome.notifications.create({
							type: "basic",
							iconUrl: "icons/icon-128.png",
							title: "BridgeHook",
							message: `${service.name} returned ${result.status} — ${evt.method} ${evt.path}`,
						});
					}
				}
				broadcastStatus();
			}
		} catch (err) {
			consecutiveErrors++;
			service.status = "error";
			service.error = err.message;
			broadcastStatus();
		}

		if (!controller.signal.aborted) {
			const delay = consecutiveErrors > 3 ? 10000 : 2000;
			setTimeout(poll, delay);
		}
	}

	poll();
	console.log(
		`[BridgeHook] Started bridge for "${service.name}" → localhost:${service.port}${service.path}`,
	);
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
	console.log(`[BridgeHook] Stopped bridge for ${serviceId}`);
}

// ── Storage & Service CRUD ───────────────────────────────────────────

async function loadServices() {
	const { services = [] } = await chrome.storage.local.get("services");
	return services;
}

async function saveServices(services) {
	await chrome.storage.local.set({ services });
}

async function addService(name, port, path) {
	const channelId = await createChannel(port, path);
	const service = {
		id: crypto.randomUUID(),
		name,
		port,
		path,
		channelId,
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

	return service;
}

async function removeService(serviceId) {
	stopBridge(serviceId);
	const service = activeBridges.get(serviceId);
	if (service?.channelId) await deleteChannelKey(service.channelId);
	activeBridges.delete(serviceId);

	const services = await loadServices();
	const updated = services.filter((s) => s.id !== serviceId);
	await saveServices(updated);
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
		if (service.active) {
			startBridge(bridge);
		} else {
			stopBridge(serviceId);
		}
	}

	broadcastStatus();
	return service.active;
}

// ── Status Broadcasting ──────────────────────────────────────────────

function broadcastStatus() {
	const services = Array.from(activeBridges.values()).map((s) => ({
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
	}));

	const activeCount = services.filter((s) => s.active && s.status === "connected").length;
	const errorCount = services.reduce((sum, s) => sum + (s.errorCount || 0), 0);

	if (errorCount > 0) {
		chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
		chrome.action.setBadgeText({ text: String(errorCount) });
	} else if (activeCount > 0) {
		chrome.action.setBadgeBackgroundColor({ color: "#22C55E" });
		chrome.action.setBadgeText({ text: String(activeCount) });
	} else {
		chrome.action.setBadgeText({ text: "" });
	}

	chrome.runtime.sendMessage({ type: "status", services }).catch(() => {
		// Popup not open
	});
}

// ── Message Handling (Popup ↔ Background) ────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	(async () => {
		switch (msg.type) {
			case "get_status": {
				const services = Array.from(activeBridges.values()).map((s) => ({
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
				}));
				sendResponse({ services });
				break;
			}
			case "add_service": {
				const service = await addService(msg.name, msg.port, msg.path);
				sendResponse({
					ok: true,
					service: {
						...service,
						webhookUrl: `${RELAY_URL}/hook/${service.channelId}`,
					},
				});
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
			case "auto_detect": {
				const alive = await scanPorts();
				sendResponse({ detected: alive, created: [] });
				break;
			}
			default:
				sendResponse({ error: "Unknown message type" });
		}
	})();
	return true; // Keep the channel open for async response
});

// ── Auto-Detect Local Servers ─────────────────────────────────────────

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

// ── Startup: Restore Active Bridges ──────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
	console.log("[BridgeHook] Extension installed/updated");
	await restoreBridges();
});

chrome.runtime.onStartup.addListener(async () => {
	console.log("[BridgeHook] Browser started, restoring bridges");
	await restoreBridges();
});

async function restoreBridges() {
	const services = await loadServices();
	for (const service of services) {
		// If the IDB key was wiped (browser data cleared, profile change, etc.) we
		// can no longer authenticate — the channel is unrecoverable. Skip it.
		const hasKey = !!(await getChannelPrivateKey(service.channelId));
		if (!hasKey) {
			console.warn(`[BridgeHook] No signing key for "${service.name}" — skipping`);
			continue;
		}
		service.status = "disconnected";
		service.error = null;
		activeBridges.set(service.id, service);
		if (service.active) startBridge(service);
	}
	broadcastStatus();
}

// Restore bridges on service worker wake-up
restoreBridges();
