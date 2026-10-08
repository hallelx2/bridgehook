/**
 * Owner-scoped event reads and replay, shared by the dashboard API
 * (routes/me.ts) and the MCP server (mcp.ts) so both behave identically.
 */
import { events, channels } from "@bridgehook/shared/db/schema";
import { and, eq } from "drizzle-orm";
import type { DB } from "./db.js";

const EVENT_ID_LEN = 16;
export const MAX_REPLAY_BODY_BYTES = 1_048_576; // 1 MB

/** Wakes executors after a replay is queued. */
export interface ReplayNotifier {
	getChannelDO(channelId: string): { fetch(req: Request): Promise<Response> };
	notifyUser(userId: string | null, payload: string): void;
}

export function safeJsonObject(raw: string | null): Record<string, string> {
	if (!raw) return {};
	try {
		const v = JSON.parse(raw);
		if (!v || typeof v !== "object" || Array.isArray(v)) return {};
		const out: Record<string, string> = {};
		for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
			if (typeof val === "string") out[k] = val;
		}
		return out;
	} catch {
		return {};
	}
}

export function freshEventId(): string {
	return crypto.randomUUID().replace(/-/g, "").slice(0, EVENT_ID_LEN);
}

/** An event, only if it belongs to one of the user's channels. */
export async function loadOwnedEvent(db: DB, userId: string, eventId: string) {
	const [row] = await db
		.select({
			id: events.id,
			channelId: events.channelId,
			method: events.method,
			path: events.path,
			requestHeaders: events.requestHeaders,
			requestBody: events.requestBody,
			responseStatus: events.responseStatus,
			responseHeaders: events.responseHeaders,
			responseBody: events.responseBody,
			latencyMs: events.latencyMs,
			error: events.error,
			receivedAt: events.receivedAt,
			kind: events.kind,
			replayOf: events.replayOf,
			replayedByUserId: events.replayedByUserId,
			deviceId: events.deviceId,
		})
		.from(events)
		.innerJoin(channels, eq(events.channelId, channels.id))
		.where(and(eq(events.id, eventId), eq(channels.userId, userId)))
		.limit(1);
	return row ?? null;
}

export type OwnedEvent = NonNullable<Awaited<ReturnType<typeof loadOwnedEvent>>>;

export function serializeEventDetail(r: OwnedEvent) {
	return {
		id: r.id,
		channelId: r.channelId,
		method: r.method,
		path: r.path,
		requestHeaders: safeJsonObject(r.requestHeaders),
		requestBody: r.requestBody,
		responseStatus: r.responseStatus,
		responseHeaders: r.responseHeaders ? safeJsonObject(r.responseHeaders) : null,
		responseBody: r.responseBody,
		latencyMs: r.latencyMs,
		error: r.error,
		receivedAt: r.receivedAt.toISOString(),
		kind: r.kind,
		replayOf: r.replayOf,
		replayedByUserId: r.replayedByUserId,
		deviceId: r.deviceId,
	};
}

export type ReplayResult =
	| { ok: true; replayId: string; channelId: string; receivedAt: string }
	| { ok: false; status: 400 | 413 | 500; error: string };

/**
 * Queue a copy of `source` (optionally with a new body and headers) as a
 * replay event on the same channel and wake its executors.
 */
export async function queueReplay(
	db: DB,
	notifier: ReplayNotifier,
	userId: string,
	source: OwnedEvent,
	edits: { body?: unknown; headers?: unknown },
): Promise<ReplayResult> {
	let nextBody: string | null;
	if (edits.body === undefined || edits.body === null) {
		nextBody = source.requestBody;
	} else if (typeof edits.body === "string") {
		if (edits.body.length > MAX_REPLAY_BODY_BYTES) {
			return { ok: false, status: 413, error: "Body too large" };
		}
		nextBody = edits.body;
	} else {
		return { ok: false, status: 400, error: "body must be a string or null" };
	}

	let nextHeaders: Record<string, string>;
	if (edits.headers === undefined || edits.headers === null) {
		nextHeaders = safeJsonObject(source.requestHeaders);
	} else if (typeof edits.headers === "object" && !Array.isArray(edits.headers)) {
		nextHeaders = {};
		for (const [k, v] of Object.entries(edits.headers as Record<string, unknown>)) {
			if (typeof v === "string") nextHeaders[k] = v;
		}
	} else {
		return { ok: false, status: 400, error: "headers must be an object or null" };
	}

	const [inserted] = await db
		.insert(events)
		.values({
			id: freshEventId(),
			channelId: source.channelId,
			method: source.method,
			path: source.path,
			requestHeaders: JSON.stringify(nextHeaders),
			requestBody: nextBody,
			kind: "replay",
			replayOf: source.id,
			replayedByUserId: userId,
		})
		.returning();
	if (!inserted) return { ok: false, status: 500, error: "Could not queue replay" };

	// Wake executors at once; they also catch it on their next poll if the
	// notify fails.
	const ssePayload = JSON.stringify({
		type: "webhook",
		id: inserted.id,
		channelId: source.channelId,
		method: inserted.method,
		path: inserted.path,
		headers: nextHeaders,
		body: nextBody ?? "",
		receivedAt: inserted.receivedAt.toISOString(),
		kind: "replay",
		replayOf: source.id,
	});
	notifier
		.getChannelDO(source.channelId)
		.fetch(new Request("https://do/notify", { method: "POST", body: ssePayload }))
		.catch((err) => console.error("DO notify failed:", err));
	notifier.notifyUser(userId, ssePayload);

	return {
		ok: true,
		replayId: inserted.id,
		channelId: inserted.channelId,
		receivedAt: inserted.receivedAt.toISOString(),
	};
}
