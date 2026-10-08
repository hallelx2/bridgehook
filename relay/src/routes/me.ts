import { TRIAL_DAYS } from "@bridgehook/shared";
/**
 * /api/me/* — session-authed dashboard endpoints. All return 404 in
 * self-host mode (no auth means no concept of "me").
 *
 * Wired into Hono via {@link buildMeRoutes}. Channel management mutations
 * (PATCH/DELETE/rotate-key) live here too because they share the same
 * "owner via session cookie" auth pattern; the per-channel ECDSA routes
 * stay in src/index.ts since they have a different auth model entirely.
 */
import { events, channels, devices, user } from "@bridgehook/shared/db/schema";
import { and, count, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { checkReplay, finiteOrNull, loadDailyEventCount, loadUserAccess } from "../access.js";
import { type Auth, getSessionUser } from "../auth.js";
import type { DB } from "../db.js";
import {
	loadOwnedEvent,
	queueReplay,
	safeJsonObject,
	serializeEventDetail,
} from "../event-store.js";
import { resolveCaller } from "../identity.js";
import { clampSyncTimeout, isResponseMode } from "../sync.js";
import { buildWebhookUrl } from "../webhook-url.js";

const PUBLIC_KEY_HEX_LEN = 130;
const HEX_RE = /^[0-9a-f]+$/i;
const MAX_FEED_LIMIT = 100;
/** Per-filter list cap; keeps every query well under D1's 100 bound parameters. */
const MAX_FILTER_IDS = 20;
const DEFAULT_FEED_LIMIT = 50;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Channel DO accessor — same shape as in index.ts. Replay needs to notify
 * the DO so any SSE subscriber wakes immediately rather than waiting for
 * the next 2-second poll cycle. The UserDO notifier mirrors fan-out to
 * the dashboard's cross-channel stream.
 */
export interface ChannelNotifier {
	getChannelDO(channelId: string): {
		fetch(req: Request): Promise<Response>;
	};
	notifyUser(userId: string | null, payload: string): void;
}

export interface MeEnv {
	auth: Auth;
	db: DB;
	notifier: ChannelNotifier;
	/** Apex for channel-host webhook URLs; null shows the path form. */
	tunnelDomain: string | null;
}

/**
 * Caller for read endpoints: a device token (`Authorization: Bearer dvc_…`)
 * or the session cookie. A paired extension has to work with no dashboard
 * session at all, and it reads identity, plan, usage and its channels here.
 * Key rotation also accepts device tokens, so an extension or CLI can adopt a
 * channel created elsewhere (dashboard, MCP agent); agent tokens are refused
 * by resolveCaller. Other mutations (channel edits, replays, deletes) stay
 * session-only.
 */
async function resolveReader(deps: MeEnv, request: Request): Promise<{ id: string } | null> {
	const caller = await resolveCaller(deps.auth, deps.db, request);
	return caller ? { id: caller.userId } : null;
}

export function buildMeRoutes(getDeps: (c: { env: unknown }) => MeEnv | null) {
	const app = new Hono();

	// ── GET /api/me ────────────────────────────────────────────────────────
	app.get("/", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await resolveReader(deps, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const [u] = await deps.db
			.select({
				id: user.id,
				email: user.email,
				name: user.name,
			})
			.from(user)
			.where(eq(user.id, sessionUser.id))
			.limit(1);
		if (!u) return c.json({ error: "User not found" }, 404);

		// Single source of truth for plan / subscription / read-only state —
		// see relay/src/access.ts. The /api/me payload is the dashboard's
		// view into that record.
		const access = await loadUserAccess(deps.db, u.id);
		if (!access) return c.json({ error: "User not found" }, 404);

		// Today's count is computed from the events table (exact). The KV
		// counter used at intake is the rate-limit gate; this number is what
		// the dashboard shows.
		const eventsToday = Number.isFinite(access.limits.eventsPerDay)
			? await loadDailyEventCount(deps.db, u.id)
			: 0;

		return c.json({
			user: { id: u.id, email: u.email, name: u.name },
			plan: access.plan,
			trialEndsAt: access.trialEndsAt?.toISOString() ?? null,
			trialDaysTotal: TRIAL_DAYS,
			// `null` here means unlimited (selfhost). Settings.tsx renders it
			// as "unlimited" rather than "null days".
			retentionDays: finiteOrNull(access.limits.retentionDays),
			eventsPerDay: finiteOrNull(access.limits.eventsPerDay),
			eventsToday,
			readOnly: access.readOnly,
			readOnlyReason: access.reason,
			subscription: access.subscription
				? {
						status: access.subscription.status,
						provider: access.subscription.provider,
						cancelAtPeriodEnd: access.subscription.cancelAtPeriodEnd,
						currentPeriodEnd: access.subscription.currentPeriodEnd.toISOString(),
					}
				: null,
		});
	});

	// ── GET /api/me/channels ───────────────────────────────────────────────
	app.get("/channels", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await resolveReader(deps, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const url = new URL(c.req.url);

		// Channel rows + a left-joined device label (so the dashboard doesn't
		// need a second round-trip per row).
		const rows = await deps.db
			.select({
				id: channels.id,
				port: channels.port,
				label: channels.label,
				allowedPaths: channels.allowedPaths,
				responseMode: channels.responseMode,
				syncTimeoutMs: channels.syncTimeoutMs,
				createdAt: channels.createdAt,
				expiresAt: channels.expiresAt,
				deviceId: channels.deviceId,
				deviceLabel: devices.label,
				deviceKind: devices.kind,
			})
			.from(channels)
			.leftJoin(devices, eq(channels.deviceId, devices.id))
			.where(eq(channels.userId, sessionUser.id))
			.orderBy(desc(channels.createdAt));

		// 24h event count + last-event lookup per channel. One round-trip,
		// grouped server-side.
		const since = new Date(Date.now() - ONE_DAY_MS);
		// Owned channels as a subquery (D1 caps bound parameters at 100).
		const owned = deps.db
			.select({ id: channels.id })
			.from(channels)
			.where(eq(channels.userId, sessionUser.id));
		const eventStats =
			rows.length === 0
				? []
				: await deps.db
						.select({
							channelId: events.channelId,
							count24h: count(),
							lastEventAt: sql<number | null>`MAX(${events.receivedAt})`,
						})
						.from(events)
						.where(and(inArray(events.channelId, owned), gte(events.receivedAt, since)))
						.groupBy(events.channelId);
		const statByChannel = new Map(eventStats.map((s) => [s.channelId, s]));

		const enriched = rows.map((r) => {
			const stat = statByChannel.get(r.id);
			return {
				id: r.id,
				port: r.port,
				label: r.label,
				allowedPaths: safeJsonArray(r.allowedPaths),
				responseMode: r.responseMode,
				syncTimeoutMs: r.syncTimeoutMs,
				createdAt: r.createdAt.toISOString(),
				expiresAt: r.expiresAt?.toISOString() ?? null,
				webhookUrl: buildWebhookUrl(r.id, url, deps.tunnelDomain),
				device: r.deviceId ? { id: r.deviceId, label: r.deviceLabel, kind: r.deviceKind } : null,
				stats: {
					count24h: stat?.count24h ?? 0,
					lastEventAt: stat?.lastEventAt ? new Date(stat.lastEventAt).toISOString() : null,
				},
			};
		});

		return c.json({ channels: enriched });
	});

	// ── PATCH /api/me/channels/:id ─────────────────────────────────────────
	app.patch("/channels/:channelId", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const channelId = c.req.param("channelId");
		if (!/^[a-z0-9]{1,24}$/.test(channelId)) {
			return c.json({ error: "Channel not found" }, 404);
		}

		const body = await c.req.json().catch(() => null);
		const patch = (body ?? {}) as {
			label?: unknown;
			allowedPaths?: unknown;
			responseMode?: unknown;
			syncTimeoutMs?: unknown;
		};

		const update: {
			label?: string | null;
			allowedPaths?: string;
			responseMode?: "async" | "sync";
			syncTimeoutMs?: number;
		} = {};
		if (patch.label !== undefined) {
			if (patch.label === null) {
				update.label = null;
			} else if (typeof patch.label === "string") {
				update.label = patch.label.trim().slice(0, 64) || null;
			} else {
				return c.json({ error: "label must be string or null" }, 400);
			}
		}
		if (patch.allowedPaths !== undefined) {
			const validated = validateAllowedPaths(patch.allowedPaths);
			if (validated === null) {
				return c.json({ error: "Invalid allowedPaths" }, 400);
			}
			update.allowedPaths = JSON.stringify(validated);
		}
		if (patch.responseMode !== undefined) {
			if (!isResponseMode(patch.responseMode)) {
				return c.json({ error: "responseMode must be 'async' or 'sync'" }, 400);
			}
			update.responseMode = patch.responseMode;
		}
		if (patch.syncTimeoutMs !== undefined) {
			const ms = clampSyncTimeout(patch.syncTimeoutMs);
			if (ms === null) return c.json({ error: "syncTimeoutMs must be a number" }, 400);
			update.syncTimeoutMs = ms;
		}
		if (Object.keys(update).length === 0) {
			return c.json({ error: "No fields to update" }, 400);
		}

		const [updated] = await deps.db
			.update(channels)
			.set(update)
			.where(and(eq(channels.id, channelId), eq(channels.userId, sessionUser.id)))
			.returning();
		if (!updated) return c.json({ error: "Channel not found" }, 404);

		return c.json({
			id: updated.id,
			label: updated.label,
			allowedPaths: safeJsonArray(updated.allowedPaths),
			responseMode: updated.responseMode,
			syncTimeoutMs: updated.syncTimeoutMs,
		});
	});

	// ── POST /api/me/channels/:id/rotate-key ───────────────────────────────
	// Recovery path — replace the channel's publicKey with one signed-in
	// users can produce fresh on the client. Closes the lost-IDB hole.
	app.post("/channels/:channelId/rotate-key", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		// Device tokens too: an extension or CLI adopting a channel created
		// elsewhere (dashboard, MCP agent) rotates in its own key.
		const sessionUser = await resolveReader(deps, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const channelId = c.req.param("channelId");
		if (!/^[a-z0-9]{1,24}$/.test(channelId)) {
			return c.json({ error: "Channel not found" }, 404);
		}

		const body = await c.req.json().catch(() => null);
		const publicKey = (body as { publicKey?: unknown } | null)?.publicKey;
		if (
			typeof publicKey !== "string" ||
			publicKey.length !== PUBLIC_KEY_HEX_LEN ||
			!HEX_RE.test(publicKey)
		) {
			return c.json({ error: "publicKey must be a 130-char hex string" }, 400);
		}
		try {
			await crypto.subtle.importKey(
				"raw",
				hexToBytes(publicKey),
				{ name: "ECDSA", namedCurve: "P-256" },
				false,
				["verify"],
			);
		} catch {
			return c.json({ error: "publicKey is not a valid ECDSA P-256 point" }, 400);
		}

		const [updated] = await deps.db
			.update(channels)
			.set({ publicKey })
			.where(and(eq(channels.id, channelId), eq(channels.userId, sessionUser.id)))
			.returning({ id: channels.id });
		if (!updated) return c.json({ error: "Channel not found" }, 404);

		return c.json({ rotated: true });
	});

	// ── DELETE /api/me/channels/:id ────────────────────────────────────────
	// Hard delete — the per-channel ECDSA path also exists on
	// DELETE /api/channels/:id; this is the session-auth equivalent.
	app.delete("/channels/:channelId", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const channelId = c.req.param("channelId");
		if (!/^[a-z0-9]{1,24}$/.test(channelId)) {
			return c.json({ error: "Channel not found" }, 404);
		}

		const [deleted] = await deps.db
			.delete(channels)
			.where(and(eq(channels.id, channelId), eq(channels.userId, sessionUser.id)))
			.returning({ id: channels.id });
		if (!deleted) return c.json({ error: "Channel not found" }, 404);

		return c.json({ deleted: true });
	});

	// ── GET /api/me/events ─────────────────────────────────────────────────
	// Unified cross-channel feed with cursor pagination + filters.
	//
	// Query params (all optional):
	//   cursor   — opaque base64 of {ts, id}; pass back to fetch next page
	//   limit    — 1..100, default 50
	//   channel  — comma-separated channel ids; default = all owned
	//   device   — comma-separated device ids
	//   method   — comma-separated HTTP methods
	//   status   — 2xx | 3xx | 4xx | 5xx | error | live | replay
	//   q        — substring of path
	//   from,to  — ISO timestamps
	app.get("/events", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await resolveReader(deps, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const url = new URL(c.req.url);
		const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
		const limit =
			Number.isFinite(limitRaw) && limitRaw > 0
				? Math.min(limitRaw, MAX_FEED_LIMIT)
				: DEFAULT_FEED_LIMIT;

		// Owner gate — a subquery, so it holds however many channels the user
		// has (D1 caps bound parameters at 100). User-supplied filter lists
		// are capped for the same reason.
		const owned = deps.db
			.select({ id: channels.id })
			.from(channels)
			.where(eq(channels.userId, sessionUser.id));
		const conditions = [inArray(events.channelId, owned)];

		// Filter: channel
		const channelFilter = parseCommaList(url.searchParams.get("channel")).slice(0, MAX_FILTER_IDS);
		if (channelFilter.length > 0) {
			conditions.push(inArray(events.channelId, channelFilter));
		}

		// Filter: device
		const deviceFilter = parseCommaList(url.searchParams.get("device")).slice(0, MAX_FILTER_IDS);
		if (deviceFilter.length > 0) {
			conditions.push(inArray(events.deviceId, deviceFilter));
		}

		// Filter: method
		const methodFilter = parseCommaList(url.searchParams.get("method"))
			.slice(0, MAX_FILTER_IDS)
			.map((m) => m.toUpperCase());
		if (methodFilter.length > 0) {
			conditions.push(inArray(events.method, methodFilter));
		}

		// Filter: status
		const statusRaw = url.searchParams.get("status");
		if (statusRaw) {
			const cond = statusFilterCondition(statusRaw);
			if (cond) conditions.push(cond);
		}

		// Filter: q (path substring). SQLite only honours a backslash escape
		// with an explicit ESCAPE clause; without it `stripe_webhook` would
		// search for a literal backslash. SQLite's LIKE ignores ASCII case,
		// which suits a path search box.
		const q = url.searchParams.get("q");
		if (q && q.trim().length > 0) {
			const pattern = `%${q.trim().replace(/[%_\\]/g, (s) => `\\${s}`)}%`;
			conditions.push(sql`${events.path} LIKE ${pattern} ESCAPE '\\'`);
		}

		// Filter: time range
		const from = parseIsoDate(url.searchParams.get("from"));
		const to = parseIsoDate(url.searchParams.get("to"));
		if (from) conditions.push(gte(events.receivedAt, from));
		if (to) conditions.push(lte(events.receivedAt, to));

		// Cursor pagination — strict (received_at, id) tuple.
		const cursor = parseCursor(url.searchParams.get("cursor"));
		if (cursor) {
			conditions.push(
				or(
					lt(events.receivedAt, cursor.receivedAt),
					and(eq(events.receivedAt, cursor.receivedAt), lt(events.id, cursor.id)),
				)!,
			);
		}

		const rows = await deps.db
			.select({
				id: events.id,
				channelId: events.channelId,
				method: events.method,
				path: events.path,
				responseStatus: events.responseStatus,
				latencyMs: events.latencyMs,
				kind: events.kind,
				replayOf: events.replayOf,
				deviceId: events.deviceId,
				receivedAt: events.receivedAt,
			})
			.from(events)
			.where(and(...conditions))
			.orderBy(desc(events.receivedAt), desc(events.id))
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const page = hasMore ? rows.slice(0, limit) : rows;
		const nextCursor =
			hasMore && page.length > 0
				? buildCursor(page[page.length - 1].receivedAt, page[page.length - 1].id)
				: null;

		return c.json({
			events: page.map((r) => ({
				id: r.id,
				channelId: r.channelId,
				method: r.method,
				path: r.path,
				responseStatus: r.responseStatus,
				latencyMs: r.latencyMs,
				kind: r.kind,
				replayOf: r.replayOf,
				deviceId: r.deviceId,
				receivedAt: r.receivedAt.toISOString(),
			})),
			nextCursor,
		});
	});

	// ── GET /api/me/events/:id ─────────────────────────────────────────────
	// Single event detail: full headers/body for both request and response,
	// plus `replays` (children that point at this id) and `original` (the
	// parent if this is itself a replay). One level of chain depth — UI
	// renders the recursion by drilling into a child via its own URL.
	app.get("/events/:eventId", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await resolveReader(deps, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const eventId = c.req.param("eventId");
		if (!/^[a-z0-9]{1,32}$/.test(eventId)) {
			return c.json({ error: "Event not found" }, 404);
		}

		const evt = await loadOwnedEvent(deps.db, sessionUser.id, eventId);
		if (!evt) return c.json({ error: "Event not found" }, 404);

		// Children: events whose replay_of points at this one.
		const children = await deps.db
			.select({
				id: events.id,
				method: events.method,
				path: events.path,
				responseStatus: events.responseStatus,
				latencyMs: events.latencyMs,
				kind: events.kind,
				deviceId: events.deviceId,
				replayedByUserId: events.replayedByUserId,
				receivedAt: events.receivedAt,
				error: events.error,
			})
			.from(events)
			.where(eq(events.replayOf, eventId))
			.orderBy(desc(events.receivedAt));

		// Original (if this is a replay): the source it points at.
		let original: { id: string; receivedAt: string; method: string; path: string } | null = null;
		if (evt.replayOf) {
			const [src] = await deps.db
				.select({
					id: events.id,
					method: events.method,
					path: events.path,
					receivedAt: events.receivedAt,
				})
				.from(events)
				.where(eq(events.id, evt.replayOf))
				.limit(1);
			if (src) {
				original = {
					id: src.id,
					method: src.method,
					path: src.path,
					receivedAt: src.receivedAt.toISOString(),
				};
			}
		}

		return c.json({
			event: serializeEventDetail(evt),
			replays: children.map((r) => ({
				id: r.id,
				method: r.method,
				path: r.path,
				responseStatus: r.responseStatus,
				latencyMs: r.latencyMs,
				kind: r.kind,
				deviceId: r.deviceId,
				replayedByUserId: r.replayedByUserId,
				receivedAt: r.receivedAt.toISOString(),
				error: r.error,
			})),
			original,
		});
	});

	// ── POST /api/me/events/:id/replay ─────────────────────────────────────
	// Queue a synthetic replay event. Inserts a new pending row on the same
	// channel; the executor picks it up on its next poll, forwards to
	// localhost, and reports back via POST /hook/:id/response.
	app.post("/events/:eventId/replay", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		// Read-only accounts (expired trial, canceled sub) can view past
		// events but not queue new replays — replay creates a new event row.
		const access = await loadUserAccess(deps.db, sessionUser.id);
		if (!access) return c.json({ error: "User not found" }, 404);
		const gate = checkReplay(access);
		if (!gate.ok) return c.json({ error: gate.error, code: "quota" }, gate.status);

		const eventId = c.req.param("eventId");
		if (!/^[a-z0-9]{1,32}$/.test(eventId)) {
			return c.json({ error: "Event not found" }, 404);
		}

		const source = await loadOwnedEvent(deps.db, sessionUser.id, eventId);
		if (!source) return c.json({ error: "Event not found" }, 404);

		const body = await c.req.json().catch(() => ({}));
		const edits = (body ?? {}) as { body?: unknown; headers?: unknown };
		const replay = await queueReplay(deps.db, deps.notifier, sessionUser.id, source, edits);
		if (!replay.ok) return c.json({ error: replay.error }, replay.status);
		return c.json({
			replayId: replay.replayId,
			channelId: replay.channelId,
			receivedAt: replay.receivedAt,
		});
	});

	// ── DELETE /api/me/events/:id ──────────────────────────────────────────
	// Cancel a queued replay. Only allowed for kind='replay' rows that have
	// not yet been answered by an executor (responseStatus IS NULL).
	app.delete("/events/:eventId", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const eventId = c.req.param("eventId");
		if (!/^[a-z0-9]{1,32}$/.test(eventId)) {
			return c.json({ error: "Event not found" }, 404);
		}

		const evt = await loadOwnedEvent(deps.db, sessionUser.id, eventId);
		if (!evt) return c.json({ error: "Event not found" }, 404);
		if (evt.kind !== "replay") {
			return c.json(
				{ error: "Only replay events can be cancelled. Live events are immutable." },
				400,
			);
		}
		if (evt.responseStatus !== null) {
			return c.json({ error: "Replay has already completed" }, 409);
		}

		await deps.db.delete(events).where(eq(events.id, eventId));
		return c.json({ deleted: true });
	});

	return app;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function safeJsonArray(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}

function validateAllowedPaths(input: unknown): string[] | null {
	if (!Array.isArray(input)) return null;
	if (input.length > 20) return null;
	const out: string[] = [];
	for (const p of input) {
		if (typeof p !== "string") return null;
		const trimmed = p.trim();
		if (trimmed.length === 0 || trimmed.length > 256) return null;
		if (!trimmed.startsWith("/")) return null;
		out.push(trimmed);
	}
	return out;
}

function parseCommaList(raw: string | null): string[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

function parseIsoDate(raw: string | null): Date | null {
	if (!raw) return null;
	const d = new Date(raw);
	return Number.isNaN(d.getTime()) ? null : d;
}

interface Cursor {
	receivedAt: Date;
	id: string;
}

function parseCursor(raw: string | null): Cursor | null {
	if (!raw) return null;
	try {
		const json = JSON.parse(atob(raw));
		if (
			!json ||
			typeof json !== "object" ||
			typeof json.ts !== "string" ||
			typeof json.id !== "string"
		) {
			return null;
		}
		const d = new Date(json.ts);
		if (Number.isNaN(d.getTime())) return null;
		return { receivedAt: d, id: json.id };
	} catch {
		return null;
	}
}

function buildCursor(ts: Date, id: string): string {
	return btoa(JSON.stringify({ ts: ts.toISOString(), id }));
}

function statusFilterCondition(raw: string) {
	switch (raw) {
		case "2xx":
			return and(gte(events.responseStatus, 200), lt(events.responseStatus, 300));
		case "3xx":
			return and(gte(events.responseStatus, 300), lt(events.responseStatus, 400));
		case "4xx":
			return and(gte(events.responseStatus, 400), lt(events.responseStatus, 500));
		case "5xx":
			return and(gte(events.responseStatus, 500), lt(events.responseStatus, 600));
		case "error":
			// Either an error string was recorded, or no response yet (executor offline).
			return or(
				sql`${events.error} IS NOT NULL`,
				and(isNull(events.responseStatus), lt(events.receivedAt, new Date(Date.now() - 30_000))),
			);
		case "pending":
			return isNull(events.responseStatus);
		case "live":
			return eq(events.kind, "live");
		case "replay":
			return eq(events.kind, "replay");
		default:
			return null;
	}
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
	const buf = new ArrayBuffer(hex.length / 2);
	const out = new Uint8Array(buf);
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
	}
	return out;
}

/**
 * Ownership-gated event load. Joins channels to verify the user owns the
 * event's channel; returns null otherwise.
 */
