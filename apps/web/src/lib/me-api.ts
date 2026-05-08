/**
 * Typed fetch helpers for the relay's /api/me/* endpoints. All requests
 * carry the Better-Auth session cookie via credentials:"include".
 *
 * Self-host mode: these endpoints 404. Callers should gate behind
 * config.authEnabled and use the existing single-channel useBridge hook
 * for self-host fallback.
 */

const RELAY_URL = import.meta.env.VITE_RELAY_URL || "http://localhost:8787";

export interface MeUser {
	user: { id: string; email: string; name: string };
	plan: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
	trialEndsAt: string | null;
	trialDaysTotal: number;
	retentionDays: number;
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
