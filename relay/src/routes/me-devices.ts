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
import { checkDevicePair, loadUserAccess } from "../access.js";
import { type Auth, getSessionUser } from "../auth.js";
import { newDeviceId, newDeviceToken } from "../identity.js";

type DB = ReturnType<typeof drizzle>;

export interface MeDevicesEnv {
	auth: Auth;
	db: DB;
}

async function sha256Hex(input: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	const arr = new Uint8Array(buf);
	let out = "";
	for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
	return out;
}

const DEVICE_KIND_RE = /^(extension|desktop|cli|web)$/;

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

	// ── Self-register the current session as a device ──────────────────────
	// The session itself is the proof of identity, so no pairing code is
	// needed — this is the shortcut for the in-browser extension / desktop
	// client that just signed in via the dashboard. The full
	// /auth/device/start → approve → exchange flow still works for headless
	// callers (CLI, untrusted browsers) where session-cookie auth isn't
	// available.
	app.post("/self-register", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const body = await c.req.json().catch(() => null);
		const raw = (body ?? {}) as { kind?: unknown; label?: unknown; userAgent?: unknown };
		const kind = typeof raw.kind === "string" ? raw.kind : "extension";
		if (!DEVICE_KIND_RE.test(kind)) {
			return c.json({ error: "kind must be 'extension'|'desktop'|'cli'|'web'" }, 400);
		}
		const labelInput =
			typeof raw.label === "string" && raw.label.trim().length > 0
				? raw.label.trim().slice(0, 96)
				: `${kind} device`;
		const userAgent = typeof raw.userAgent === "string" ? raw.userAgent.slice(0, 512) : null;

		// Same quota gate the device-pair `/exchange` runs — we don't want a
		// session-authed shortcut to skip the Hobby/Pro device cap.
		const access = await loadUserAccess(deps.db, sessionUser.id);
		if (!access) return c.json({ error: "User not found" }, 404);
		const gate = await checkDevicePair(deps.db, access);
		if (!gate.ok) return c.json({ error: gate.error, code: "quota" }, gate.status);

		const token = newDeviceToken();
		const tokenHash = await sha256Hex(token);
		const deviceId = newDeviceId();

		await deps.db.insert(devices).values({
			id: deviceId,
			userId: sessionUser.id,
			kind,
			label: labelInput,
			tokenHash,
			userAgent,
			lastSeenAt: new Date(),
		});

		// Token is shown to the caller exactly once — only the SHA-256 hash
		// hits the DB. The caller stores the plaintext locally and sends it
		// as `Authorization: Bearer dvc_…` on subsequent requests.
		return c.json({ token, deviceId, userId: sessionUser.id, label: labelInput, kind }, 201);
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
