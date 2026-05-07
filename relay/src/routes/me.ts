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
import {
	and,
	count,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNull,
	like,
	lt,
	lte,
	or,
	sql,
} from "drizzle-orm";
import type { drizzle } from "drizzle-orm/neon-http";
import { Hono } from "hono";
import { type Auth, getSessionUser } from "../auth.js";

type DB = ReturnType<typeof drizzle>;

const PUBLIC_KEY_HEX_LEN = 130;
const HEX_RE = /^[0-9a-f]+$/i;
const MAX_FEED_LIMIT = 100;
const DEFAULT_FEED_LIMIT = 50;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface MeEnv {
	auth: Auth;
	db: DB;
}

export function buildMeRoutes(getDeps: (c: { env: unknown }) => MeEnv | null) {
	const app = new Hono();

	// ── GET /api/me ────────────────────────────────────────────────────────
	app.get("/", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const [u] = await deps.db
			.select({
				id: user.id,
				email: user.email,
				name: user.name,
				plan: user.plan,
				trialEndsAt: user.trialEndsAt,
				createdAt: user.createdAt,
			})
			.from(user)
			.where(eq(user.id, sessionUser.id))
			.limit(1);
		if (!u) return c.json({ error: "User not found" }, 404);

		// Retention is plan-driven; the actual sweep cron lands in commit 14.
		const retentionDays = u.plan === "active" ? 30 : 7;

		return c.json({
			user: { id: u.id, email: u.email, name: u.name },
			plan: u.plan,
			trialEndsAt: u.trialEndsAt?.toISOString() ?? null,
			trialDaysTotal: TRIAL_DAYS,
			retentionDays,
		});
	});

	// ── GET /api/me/channels ───────────────────────────────────────────────
	app.get("/channels", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
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
		const channelIds = rows.map((r) => r.id);
		const eventStats =
			channelIds.length === 0
				? []
				: await deps.db
						.select({
							channelId: events.channelId,
							count24h: count(),
							lastEventAt: sql<Date | null>`MAX(${events.receivedAt})`,
						})
						.from(events)
						.where(and(inArray(events.channelId, channelIds), gte(events.receivedAt, since)))
						.groupBy(events.channelId);
		const statByChannel = new Map(eventStats.map((s) => [s.channelId, s]));

		const enriched = rows.map((r) => {
			const stat = statByChannel.get(r.id);
			return {
				id: r.id,
				port: r.port,
				label: r.label,
				allowedPaths: safeJsonArray(r.allowedPaths),
				createdAt: r.createdAt.toISOString(),
				expiresAt: r.expiresAt?.toISOString() ?? null,
				webhookUrl: `${url.origin}/hook/${r.id}`,
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
		};

		const update: { label?: string | null; allowedPaths?: string } = {};
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
		});
	});

	// ── POST /api/me/channels/:id/rotate-key ───────────────────────────────
	// Recovery path — replace the channel's publicKey with one signed-in
	// users can produce fresh on the client. Closes the lost-IDB hole.
	app.post("/channels/:channelId/rotate-key", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
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
			.set({ publicKey, secretHash: null })
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

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const url = new URL(c.req.url);
		const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
		const limit =
			Number.isFinite(limitRaw) && limitRaw > 0
				? Math.min(limitRaw, MAX_FEED_LIMIT)
				: DEFAULT_FEED_LIMIT;

		// Owner gate — restrict to channels the user owns.
		const ownedChannels = await deps.db
			.select({ id: channels.id })
			.from(channels)
			.where(eq(channels.userId, sessionUser.id));
		if (ownedChannels.length === 0) {
			return c.json({ events: [], nextCursor: null });
		}
		const ownedIds = ownedChannels.map((r) => r.id);

		// Filter: channel
		const channelFilter = parseCommaList(url.searchParams.get("channel"));
		const channelIds =
			channelFilter.length > 0 ? channelFilter.filter((id) => ownedIds.includes(id)) : ownedIds;
		if (channelIds.length === 0) {
			return c.json({ events: [], nextCursor: null });
		}

		const conditions = [inArray(events.channelId, channelIds)];

		// Filter: device
		const deviceFilter = parseCommaList(url.searchParams.get("device"));
		if (deviceFilter.length > 0) {
			conditions.push(inArray(events.deviceId, deviceFilter));
		}

		// Filter: method
		const methodFilter = parseCommaList(url.searchParams.get("method")).map((m) => m.toUpperCase());
		if (methodFilter.length > 0) {
			conditions.push(inArray(events.method, methodFilter));
		}

		// Filter: status
		const statusRaw = url.searchParams.get("status");
		if (statusRaw) {
			const cond = statusFilterCondition(statusRaw);
			if (cond) conditions.push(cond);
		}

		// Filter: q (path substring)
		const q = url.searchParams.get("q");
		if (q && q.trim().length > 0) {
			const pattern = `%${q.trim().replace(/[%_]/g, (s) => `\\${s}`)}%`;
			conditions.push(like(events.path, pattern));
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
				and(
					isNull(events.responseStatus),
					gt(sql<number>`EXTRACT(EPOCH FROM (NOW() - ${events.receivedAt}))`, 30),
				),
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
