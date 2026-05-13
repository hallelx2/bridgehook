/**
 * Client-side API helpers for talking to the relay server.
 *
 * All DB operations happen server-side on the relay — the client only makes
 * fetch() calls. Authenticated requests are signed with a per-channel ECDSA
 * key stored as a non-extractable CryptoKey in IndexedDB. See ./crypto.ts.
 *
 * Uses polling (not SSE) because Cloudflare Workers free tier kills idle
 * connections after ~30s. Polling every 2s is reliable.
 */

import { deleteChannelKey, generateChannelKey, signedFetch } from "./crypto";

const RELAY_URL = import.meta.env.VITE_RELAY_URL || "http://localhost:8787";

export interface ChannelInfo {
	channelId: string;
	port: number;
	expiresAt: string;
	webhookUrl: string;
}

export interface WebhookEventData {
	id: string;
	channelId: string;
	method: string;
	path: string;
	requestHeaders: string;
	requestBody: string | null;
	responseStatus: number | null;
	responseHeaders: string | null;
	responseBody: string | null;
	latencyMs: number | null;
	error: string | null;
	receivedAt: string;
}

export interface SSEWebhookEvent {
	type: "webhook";
	id: string;
	channelId: string;
	method: string;
	path: string;
	headers: Record<string, string>;
	body: string;
	receivedAt: string;
}

export interface SSEResponseEvent {
	type: "response";
	eventId: string;
	status: number;
	latencyMs: number;
}

export interface SSEClaimedEvent {
	type: "claimed";
	eventId: string;
	claimerId: string;
	claimedAt: string;
}

export type SSEEvent =
	| { type: "connected"; channelId: string }
	| SSEWebhookEvent
	| SSEResponseEvent
	| SSEClaimedEvent;

// ── Safe JSON parse helper (re-exported for hooks) ────────────────────────
export function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

// ── Create channel ────────────────────────────────────────────────────────
/**
 * Generates a per-channel keypair, stores the private key non-extractable in
 * IndexedDB, and sends the public key to the relay. The server will verify
 * all subsequent authenticated requests against that public key.
 *
 * Prefer {@link findOrCreateChannelForPort} when the user might be signed in
 * — it gives back the same channel id for the same (user, port) pair on
 * repeated calls, so the webhook URL is stable across sessions / browsers.
 */
export async function createChannel(port: number, allowedPaths: string[]): Promise<ChannelInfo> {
	// Temporarily hold a channel id placeholder; IDB is keyed by channel id,
	// but we don't know the id until the server responds. We generate into a
	// temp slot, then rename on success.
	const tempId = `pending-${crypto.randomUUID()}`;
	const publicKey = await generateChannelKey(tempId);

	try {
		const res = await fetch(`${RELAY_URL}/api/channels`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			// credentials: "include" carries the Better-Auth session cookie cross-subdomain
			// so the relay can stamp channels.user_id when the user is signed in.
			// Self-host mode ignores this — the relay attaches to the implicit user.
			credentials: "include",
			body: JSON.stringify({ publicKey, port, allowedPaths }),
		});

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`Failed to create channel: ${res.status}${text ? ` — ${text}` : ""}`);
		}
		const data = (await res.json()) as ChannelInfo;

		// Move the key record from the temp id to the real channel id.
		await renameKey(tempId, data.channelId);
		return data;
	} catch (err) {
		// If channel creation failed, don't leak the orphan key.
		await deleteChannelKey(tempId);
		throw err;
	}
}

/**
 * Stable-URL channel resolver. When the user is signed in we want the
 * webhook URL for a given local port to be a permanent fixture of their
 * account — pasting it into Stripe/Paystack/etc. once and never having
 * to update it again, even after clearing browser storage or switching
 * devices.
 *
 * Algorithm:
 *   1. Look up the user's existing channels and check if any owns this
 *      port. If yes:
 *      a. If IndexedDB still has the matching private key, reuse the
 *         channel as-is (this is the warm path).
 *      b. If the key is missing (cleared storage, different profile,
 *         …), generate a fresh keypair and rotate the channel's public
 *         key on the server. Same channel id, same webhook URL — the
 *         only externally visible side effect is the signing material
 *         changing.
 *   2. If no match, fall back to {@link createChannel} (fresh channel,
 *      fresh URL).
 *
 * Anonymous callers (signed out, self-host) skip the lookup entirely
 * since `/api/me/channels` would 401/404; they get the legacy
 * fresh-channel-each-time behavior.
 */
export async function findOrCreateChannelForPort(
	port: number,
	allowedPaths: string[],
): Promise<ChannelInfo> {
	const { me } = await import("./me-api");

	const existing = await me.channels.findByPort(port);
	if (existing) {
		const { idbGet } = await import("./idb");
		const hasKey = !!(await idbGet(`channel-key:${existing.id}`));
		if (!hasKey) {
			// We own the channel but lost the key — mint a fresh one
			// and rotate.
			const publicKey = await generateChannelKey(existing.id);
			try {
				await me.channels.rotateKey(existing.id, publicKey);
			} catch (err) {
				// Rotate failed (network, race, …). Drop the partial key
				// so the next attempt starts clean.
				await deleteChannelKey(existing.id);
				throw err;
			}
		}
		return {
			channelId: existing.id,
			port: existing.port,
			expiresAt: existing.expiresAt ?? "",
			webhookUrl: existing.webhookUrl,
		};
	}

	return createChannel(port, allowedPaths);
}

async function renameKey(fromId: string, toId: string): Promise<void> {
	// Pull the existing record and re-put under the new id. The CryptoKey
	// object survives structured clone — including its non-extractable flag.
	const { idbGet, idbPut, idbDelete } = await import("./idb");
	const record = await idbGet(`channel-key:${fromId}`);
	if (!record) return;
	await idbPut(`channel-key:${toId}`, record);
	await idbDelete(`channel-key:${fromId}`);
}

// ── Get channel info (public — no auth needed) ────────────────────────────
export async function getChannel(channelId: string): Promise<ChannelInfo | null> {
	const res = await fetch(`${RELAY_URL}/api/channels/${encodeURIComponent(channelId)}`, {
		credentials: "include",
	});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`Failed to get channel: ${res.status}`);
	return res.json() as Promise<ChannelInfo>;
}

// ── Delete channel (signed) ───────────────────────────────────────────────
export async function deleteChannel(channelId: string): Promise<void> {
	try {
		await signedFetch(
			`${channelId}`,
			`${RELAY_URL}/api/channels/${encodeURIComponent(channelId)}`,
			{
				method: "DELETE",
			},
		);
	} finally {
		await deleteChannelKey(channelId);
	}
}

// ── Fetch events (signed) ─────────────────────────────────────────────────
export async function getEvents(
	channelId: string,
	limit = 50,
	signal?: AbortSignal,
): Promise<WebhookEventData[]> {
	const params = new URLSearchParams({ limit: String(limit) });
	const res = await signedFetch(
		channelId,
		`${RELAY_URL}/api/channels/${encodeURIComponent(channelId)}/events?${params}`,
		{ signal },
	);
	if (!res.ok) throw new Error(`Failed to get events: ${res.status}`);
	return res.json() as Promise<WebhookEventData[]>;
}

// ── Polling ───────────────────────────────────────────────────────────────
/**
 * Poll for new events every `intervalMs`.
 * Returns a cleanup function to stop polling.
 * Calls `onNewEvents` only when new events are detected (by comparing IDs).
 *
 * On transient errors, applies exponential backoff (capped at 30s).
 */
export function pollEvents(
	channelId: string,
	onNewEvents: (events: WebhookEventData[]) => void,
	onError?: (error: Error) => void,
	intervalMs = 2000,
	signal?: AbortSignal,
): () => void {
	let lastSeenId: string | null = null;
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let consecutiveErrors = 0;
	const maxBackoffMs = 30_000;

	function schedule(delay: number) {
		if (stopped) return;
		timer = setTimeout(poll, delay);
	}

	async function poll() {
		if (stopped) return;
		try {
			const events = await getEvents(channelId, 50, signal);
			consecutiveErrors = 0;
			if (events.length > 0 && events[0].id !== lastSeenId) {
				lastSeenId = events[0].id;
				onNewEvents(events);
			}
			schedule(intervalMs);
		} catch (err) {
			if (stopped) return;
			if (err instanceof DOMException && err.name === "AbortError") return;

			consecutiveErrors++;
			const errObj = err instanceof Error ? err : new Error(String(err));
			onError?.(errObj);

			const backoff = Math.min(intervalMs * 2 ** consecutiveErrors, maxBackoffMs);
			schedule(backoff);
		}
	}

	const onAbort = () => stop();
	signal?.addEventListener("abort", onAbort);

	poll();

	// Fire an initial "connected" signal so UI can flip state
	onNewEvents([]);

	function stop() {
		if (stopped) return;
		stopped = true;
		if (timer) clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}

	return stop;
}

// ── Forward webhook to localhost (unchanged — no signing needed) ──────────
export async function forwardToLocalhost(
	event: SSEWebhookEvent | WebhookEventData,
	port: number,
	signal?: AbortSignal,
): Promise<{ status: number; headers: Record<string, string>; body: string; latencyMs: number }> {
	const start = performance.now();

	const eventPath = event.path.replace(/^\/hook\/[a-z0-9]+/, "") || "/";

	const rawHeaders: Record<string, string> =
		"requestHeaders" in event
			? safeParseJson<Record<string, string>>(event.requestHeaders, {})
			: event.headers;

	const skipHeaders = new Set([
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
		"content-length",
	]);
	const headers: Record<string, string> = {};
	for (const [k, v] of Object.entries(rawHeaders)) {
		if (!skipHeaders.has(k.toLowerCase())) {
			headers[k] = v;
		}
	}

	const body = "requestBody" in event ? event.requestBody : event.body;
	const method = event.method;

	const response = await fetch(`http://localhost:${port}${eventPath}`, {
		method,
		headers,
		body: body || undefined,
		signal,
	});

	const latencyMs = Math.round(performance.now() - start);
	const respBody = await response.text();
	const respHeaders: Record<string, string> = {};
	response.headers.forEach((v, k) => {
		respHeaders[k] = v;
	});

	return { status: response.status, headers: respHeaders, body: respBody, latencyMs };
}

// ── Claim event for this executor (signed) ────────────────────────────────
/**
 * Atomic multi-device arbitration. Many executors can be connected to the
 * same channel (extension + this dashboard tab + paired desktop); only one
 * should forward each event. Whoever wins the claim races forwards; the
 * losers see `claimed: false` and drop the work.
 *
 * The clientId here is the per-session tab UUID returned by getClientId().
 * It's stored in events.claimed_by_device_id as a free-form string
 * (the FK was dropped in migration 0007 specifically to allow this).
 */
export async function claimEvent(
	channelId: string,
	eventId: string,
	clientId: string,
	signal?: AbortSignal,
): Promise<{ claimed: true } | { claimed: false; claimerId: string | null }> {
	const res = await signedFetch(
		channelId,
		`${RELAY_URL}/hook/${encodeURIComponent(channelId)}/claim`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ eventId, clientId }),
			signal,
		},
	);
	if (res.status === 409) {
		const data = (await res.json().catch(() => ({}))) as { claimerId?: string | null };
		return { claimed: false, claimerId: data.claimerId ?? null };
	}
	if (!res.ok) throw new Error(`claim failed: ${res.status}`);
	return { claimed: true };
}

/**
 * Stable per-tab identifier used as the clientId for claim arbitration.
 * Persisted in sessionStorage so a refresh keeps the same id (avoids stranding
 * pending claims across the reload). New tab → new id.
 */
const CLIENT_ID_KEY = "bridgehook:client-id";
let cachedClientId: string | null = null;

export function getClientId(): string {
	if (cachedClientId) return cachedClientId;
	try {
		const existing = sessionStorage.getItem(CLIENT_ID_KEY);
		if (existing) {
			cachedClientId = existing;
			return existing;
		}
	} catch {
		/* sessionStorage unavailable (e.g. SSR) — fall through */
	}
	const fresh = `web_${crypto.randomUUID()}`;
	cachedClientId = fresh;
	try {
		sessionStorage.setItem(CLIENT_ID_KEY, fresh);
	} catch {
		/* best-effort persistence */
	}
	return fresh;
}

// ── Send response back to relay (signed) ──────────────────────────────────
export async function sendResponse(
	channelId: string,
	eventId: string,
	response: { status: number; headers: Record<string, string>; body: string; latencyMs: number },
	signal?: AbortSignal,
): Promise<void> {
	const body = JSON.stringify({ eventId, ...response });
	await signedFetch(channelId, `${RELAY_URL}/hook/${encodeURIComponent(channelId)}/response`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
		signal,
	});
}

export { RELAY_URL };
