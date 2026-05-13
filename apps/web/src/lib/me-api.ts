/**
 * Typed fetch helpers for the relay's /api/me/* endpoints. All requests
 * carry the Better-Auth session cookie via credentials:"include".
 *
 * Self-host mode: these endpoints 404. Callers should gate behind
 * config.authEnabled and use the existing single-channel useBridge hook
 * for self-host fallback.
 */

const RELAY_URL = import.meta.env.VITE_RELAY_URL || "http://localhost:8787";

export interface MeSubscription {
	/** Polar-side lifecycle: active | trialing | past_due | canceled | incomplete | revoked */
	status: string;
	provider: string;
	cancelAtPeriodEnd: boolean;
	currentPeriodEnd: string;
}

export interface MeUser {
	user: { id: string; email: string; name: string };
	/**
	 * Effective tier — drives quota/feature gating. `free` is the launch
	 * default; `selfhost` is internal (the implicit user on self-hosted
	 * relays); `trialing` is legacy. The dashboard never renders a checkout
	 * for `selfhost`.
	 */
	plan: "free" | "trialing" | "hobby" | "pro" | "team" | "selfhost";
	trialEndsAt: string | null;
	trialDaysTotal: number;
	/** null = unlimited (selfhost). */
	retentionDays: number | null;
	/** Daily webhook intake cap. null = unlimited. */
	eventsPerDay: number | null;
	/** Exact count of webhooks received so far today (UTC). */
	eventsToday: number;
	/** True when account is locked to view-only (expired trial / canceled sub). */
	readOnly: boolean;
	readOnlyReason: "trial-expired" | "subscription-canceled" | null;
	/** Polar subscription, null if the user has never checked out. */
	subscription: MeSubscription | null;
}

export interface MeChannel {
	id: string;
	port: number;
	label: string | null;
	allowedPaths: string[];
	createdAt: string;
	expiresAt: string | null;
	webhookUrl: string;
	device: { id: string; label: string; kind: string } | null;
	stats: { count24h: number; lastEventAt: string | null };
}

export interface MeDevice {
	id: string;
	kind: "extension" | "desktop" | "cli" | "web";
	label: string;
	os: string | null;
	userAgent: string | null;
	lastSeenAt: string | null;
	createdAt: string;
}

export interface MeEvent {
	id: string;
	channelId: string;
	method: string;
	path: string;
	responseStatus: number | null;
	latencyMs: number | null;
	kind: "live" | "replay";
	replayOf: string | null;
	deviceId: string | null;
	receivedAt: string;
}

export interface MeEventDetail {
	event: {
		id: string;
		channelId: string;
		method: string;
		path: string;
		requestHeaders: Record<string, string>;
		requestBody: string | null;
		responseStatus: number | null;
		responseHeaders: Record<string, string> | null;
		responseBody: string | null;
		latencyMs: number | null;
		error: string | null;
		receivedAt: string;
		kind: "live" | "replay";
		replayOf: string | null;
		replayedByUserId: string | null;
		deviceId: string | null;
	};
	replays: Array<MeEvent & { replayedByUserId: string | null; error: string | null }>;
	original: { id: string; receivedAt: string; method: string; path: string } | null;
}

export interface EventsFeedResponse {
	events: MeEvent[];
	nextCursor: string | null;
}

export interface EventsFeedFilters {
	cursor?: string;
	limit?: number;
	channel?: string[];
	device?: string[];
	method?: string[];
	status?: "2xx" | "3xx" | "4xx" | "5xx" | "error" | "pending" | "live" | "replay";
	q?: string;
	from?: string;
	to?: string;
}

async function meFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`${RELAY_URL}/api/me${path}`, {
		credentials: "include",
		...init,
		headers: {
			"Content-Type": "application/json",
			...init.headers,
		},
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`${path} → ${res.status}${text ? `: ${text}` : ""}`);
	}
	return (await res.json()) as T;
}

export const me = {
	get: () => meFetch<MeUser>(""),

	channels: {
		list: () => meFetch<{ channels: MeChannel[] }>("/channels"),
		/**
		 * Find the caller's existing channel for a given local port, or null.
		 * Drives the "stable webhook URL per port" UX: instead of minting a
		 * fresh channel every time the user re-bridges port 3000, we hand
		 * back the same one. Caller is responsible for rotate-key if their
		 * local IDB private key is missing.
		 *
		 * Returns null on any error (not signed in, network blip, …) so
		 * callers can safely fall back to creating a new channel.
		 */
		findByPort: async (port: number): Promise<MeChannel | null> => {
			try {
				const { channels } = await meFetch<{ channels: MeChannel[] }>("/channels");
				return channels.find((c) => c.port === port) ?? null;
			} catch {
				return null;
			}
		},
		patch: (id: string, patch: { label?: string | null; allowedPaths?: string[] }) =>
			meFetch<{ id: string; label: string | null; allowedPaths: string[] }>(
				`/channels/${encodeURIComponent(id)}`,
				{ method: "PATCH", body: JSON.stringify(patch) },
			),
		remove: (id: string) =>
			meFetch<{ deleted: true }>(`/channels/${encodeURIComponent(id)}`, { method: "DELETE" }),
		rotateKey: (id: string, publicKey: string) =>
			meFetch<{ rotated: true }>(`/channels/${encodeURIComponent(id)}/rotate-key`, {
				method: "POST",
				body: JSON.stringify({ publicKey }),
			}),
	},

	devices: {
		list: () => meFetch<{ devices: MeDevice[] }>("/devices"),
		rename: (id: string, label: string) =>
			meFetch<{ device: MeDevice }>(`/devices/${encodeURIComponent(id)}`, {
				method: "PATCH",
				body: JSON.stringify({ label }),
			}),
		revoke: (id: string) =>
			meFetch<{ revoked: true }>(`/devices/${encodeURIComponent(id)}`, { method: "DELETE" }),
	},

	events: {
		feed: (filters: EventsFeedFilters = {}): Promise<EventsFeedResponse> => {
			const params = new URLSearchParams();
			if (filters.cursor) params.set("cursor", filters.cursor);
			if (filters.limit !== undefined) params.set("limit", String(filters.limit));
			if (filters.channel?.length) params.set("channel", filters.channel.join(","));
			if (filters.device?.length) params.set("device", filters.device.join(","));
			if (filters.method?.length) params.set("method", filters.method.join(","));
			if (filters.status) params.set("status", filters.status);
			if (filters.q) params.set("q", filters.q);
			if (filters.from) params.set("from", filters.from);
			if (filters.to) params.set("to", filters.to);
			const qs = params.toString();
			return meFetch<EventsFeedResponse>(`/events${qs ? `?${qs}` : ""}`);
		},
		get: (id: string) => meFetch<MeEventDetail>(`/events/${encodeURIComponent(id)}`),
		replay: (id: string, edits: { body?: string; headers?: Record<string, string> } = {}) =>
			meFetch<{ replayId: string; channelId: string; receivedAt: string }>(
				`/events/${encodeURIComponent(id)}/replay`,
				{ method: "POST", body: JSON.stringify(edits) },
			),
		cancel: (id: string) =>
			meFetch<{ deleted: true }>(`/events/${encodeURIComponent(id)}`, { method: "DELETE" }),
	},
};

/** RELAY_URL re-export so pages can build absolute URLs (e.g. webhook URL chips). */
export { RELAY_URL };

// ── Cross-channel push (SSE) ──────────────────────────────────────────────
//
// `streamMeEvents()` opens an EventSource to /api/me/stream — a long-lived
// connection backed by the relay's per-user UserDO. Every webhook landing
// on any of the caller's channels arrives here as a `{ type: "webhook" }`
// frame; responses arrive as `{ type: "response" }`; claim arbitration
// fan-outs arrive as `{ type: "claimed" }`.
//
// Self-host instances 404 on this endpoint. Pages that consume the stream
// should fall back to per-page fetches when `error` fires (or check
// `config.authEnabled` upfront).

export type MeStreamEvent =
	| { type: "connected" }
	| {
			type: "webhook";
			id: string;
			channelId: string;
			method: string;
			path: string;
			headers: Record<string, string>;
			body: string;
			receivedAt: string;
			kind?: "live" | "replay";
			replayOf?: string | null;
	  }
	| {
			type: "response";
			eventId: string;
			channelId: string;
			status: number;
			latencyMs: number;
	  }
	| {
			type: "claimed";
			eventId: string;
			channelId: string;
			claimerId: string;
			claimedAt: string;
	  };

export interface MeStreamHandle {
	close(): void;
}

/**
 * Subscribe to the per-user SSE stream. Returns a handle whose `close()`
 * tears down the EventSource. The browser auto-reconnects on transient
 * disconnects; `onError` lets the caller fall back to polling after
 * persistent failures (e.g. self-host instances where /me/stream 404s).
 */
export function streamMeEvents(
	onEvent: (e: MeStreamEvent) => void,
	onError?: (err: Event) => void,
): MeStreamHandle {
	const url = `${RELAY_URL}/api/me/stream`;
	const es = new EventSource(url, { withCredentials: true });
	es.onmessage = (msg) => {
		try {
			const data = JSON.parse(msg.data) as MeStreamEvent;
			onEvent(data);
		} catch (err) {
			console.warn("me-stream: malformed payload", err);
		}
	};
	if (onError) es.onerror = onError;
	return {
		close: () => es.close(),
	};
}
