/**
 * BridgeHook Extension — Background Service Worker
 *
 * This replaces the browser tab as the bridge between the relay server
 * and localhost. Unlike a web page, extensions are exempt from CORS and
 * mixed content restrictions, so forwarding from HTTPS relay to HTTP
 * localhost works perfectly.
 *
 * Architecture:
 *   Relay (HTTPS) → SSE/polling → Extension background.js → fetch → localhost (HTTP)
 *   localhost response → Extension → POST → Relay
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

// ── Relay API ────────────────────────────────────────────────────────

async function createChannel(port, path) {
	// Generate a secret hash for channel authentication
	const secret = crypto.randomUUID();
	const encoder = new TextEncoder();
	const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
	const secretHash = Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	const res = await fetch(`${RELAY_URL}/api/channels`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ secretHash, port, allowedPaths: [path] }),
	});
	if (!res.ok) throw new Error(`Relay returned ${res.status}`);
	const data = await res.json();
	return data.channelId;
}

async function fetchEvents(channelId, limit = 50) {
	const res = await fetch(`${RELAY_URL}/api/channels/${channelId}/events?limit=${limit}`);
	if (!res.ok) throw new Error(`Failed to get events: ${res.status}`);
	return res.json();
}

async function sendResponseToRelay(channelId, eventId, response) {
	await fetch(`${RELAY_URL}/hook/${channelId}/response`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			eventId,
			status: response.status,
			headers: response.headers,
			body: response.body,
			latencyMs: response.latencyMs,
		}),
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

	// Parse headers
	const rawHeaders =
		typeof event.requestHeaders === "string"
			? JSON.parse(event.requestHeaders || "{}")
			: event.headers || {};

	// Strip headers that break localhost forwarding
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
		if (!skip.has(k.toLowerCase())) {
			headers[k] = v;
		}
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

		return {
			status: 0,
			headers: {},
			body: "",
			latencyMs,
			error: msg,
		};
	}
}

// ── Bridge Loop ──────────────────────────────────────────────────────

/**
 * Start the bridge polling loop for a service.
 * Polls the relay for new events, forwards to localhost, sends responses back.
 */
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

			// Update service status
			service.status = "connected";
			service.error = null;
			broadcastStatus();

			// Find unforwarded events (no response yet)
			const unforwarded = events.filter(
				(e) => !e.responseStatus && !e.error && !forwarded.has(e.id),
			);

			for (const evt of unforwarded) {
				forwarded.add(evt.id);
				service.eventCount = (service.eventCount || 0) + 1;

				const result = await forwardToLocalhost(evt, service.port, service.path);

				if (result.error) {
					service.errorCount = (service.errorCount || 0) + 1;

					// Show notification on error
					chrome.notifications.create({
						type: "basic",
						iconUrl: "icons/icon-128.png",
						title: "BridgeHook",
						message: `${service.name}: ${result.error}`,
					});
				} else {
					// Send response back to relay
					await sendResponseToRelay(service.channelId, evt.id, result);

					// Notify on HTTP error status
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
			// Poll every 2 seconds, with backoff on errors
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

	// Update badge
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

	// Send to popup if open
	chrome.runtime.sendMessage({ type: "status", services }).catch(() => {
		// Popup not open, ignore
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
				// Just scan — don't auto-create bridges
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

/**
 * Probe a single port to see if a server is running.
 * Extensions can fetch localhost without CORS — so this just works.
 */
async function probePort(port) {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 1500);
		const res = await fetch(`http://localhost:${port}/`, {
			method: "HEAD",
			signal: controller.signal,
		});
		clearTimeout(timeout);
		// Any response (even 404) means a server is listening
		const serverHeader = res.headers.get("server") || res.headers.get("x-powered-by") || null;
		return { port, alive: true, status: res.status, server: serverHeader };
	} catch {
		return { port, alive: false, status: 0, server: null };
	}
}

/**
 * Scan all common ports and return which ones have running servers.
 */
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
		service.status = "disconnected";
		service.error = null;
		activeBridges.set(service.id, service);
		if (service.active) {
			startBridge(service);
		}
	}
	broadcastStatus();
}

// Restore bridges on service worker wake-up
restoreBridges();
