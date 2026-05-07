/**
 * /api/me/devices — session-authed device management for the web dashboard.
 *
 * In self-host mode (auth disabled) all four endpoints return 404; the
 * implicit single-user setup has no concept of "my devices."
 */
import { devices } from "@bridgehook/shared/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/neon-http";
import { Hono } from "hono";
import { type Auth, getSessionUser } from "../auth.js";

type DB = ReturnType<typeof drizzle>;

export interface MeDevicesEnv {
	auth: Auth;
	db: DB;
}

export function buildMeDevicesRoutes(getDeps: (c: { env: unknown }) => MeDevicesEnv | null) {
	const app = new Hono();

	// ── List active devices for the signed-in user ─────────────────────────
	app.get("/", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const rows = await deps.db
			.select({
				id: devices.id,
				kind: devices.kind,
				label: devices.label,
				os: devices.os,
				userAgent: devices.userAgent,
				lastSeenAt: devices.lastSeenAt,
				createdAt: devices.createdAt,
			})
			.from(devices)
			.where(and(eq(devices.userId, sessionUser.id), isNull(devices.revokedAt)))
			.orderBy(desc(devices.lastSeenAt));

		return c.json({ devices: rows });
	});

	// ── Rename a device ────────────────────────────────────────────────────
	app.patch("/:deviceId", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const deviceId = c.req.param("deviceId");
		if (!/^dev_[a-z0-9]{20}$/.test(deviceId)) {
			return c.json({ error: "Device not found" }, 404);
		}

		const body = await c.req.json().catch(() => null);
		const label = (body as { label?: unknown } | null)?.label;
		if (typeof label !== "string" || label.trim().length === 0) {
			return c.json({ error: "label is required" }, 400);
		}
		const trimmed = label.trim().slice(0, 96);

		const [updated] = await deps.db
			.update(devices)
			.set({ label: trimmed })
			.where(
				and(
					eq(devices.id, deviceId),
					eq(devices.userId, sessionUser.id),
					isNull(devices.revokedAt),
				),
			)
			.returning();
		if (!updated) return c.json({ error: "Device not found" }, 404);

		return c.json({ device: updated });
	});

	// ── Revoke a device (soft) ─────────────────────────────────────────────
	app.delete("/:deviceId", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const deviceId = c.req.param("deviceId");
		if (!/^dev_[a-z0-9]{20}$/.test(deviceId)) {
			return c.json({ error: "Device not found" }, 404);
		}

		const [updated] = await deps.db
			.update(devices)
			.set({ revokedAt: new Date() })
			.where(
				and(
					eq(devices.id, deviceId),
					eq(devices.userId, sessionUser.id),
					isNull(devices.revokedAt),
				),
			)
			.returning({ id: devices.id });
		if (!updated) return c.json({ error: "Device not found" }, 404);

		return c.json({ revoked: true });
	});

	return app;
}
