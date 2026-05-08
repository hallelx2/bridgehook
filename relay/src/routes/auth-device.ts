/**
 * Device pairing flow — OAuth-style "device authorization grant" pattern,
 * adapted to BridgeHook's extension/desktop/CLI executors.
 *
 * Flow:
 *   1. Extension calls POST /auth/device/start
 *      → relay generates a deviceCode (DV-XXXX-XXXX), stores 'pending' row,
 *        returns the code + a verificationUrl pointing at the web app
 *   2. Extension opens chrome.tabs.create({ url: verificationUrl })
 *   3. User signs in on the web app (if not already), then approves the code
 *      via POST /auth/device/approve { code } (session-authed)
 *   4. Extension polls POST /auth/device/exchange { code } every ~5s
 *      → 202 while pending, 200 with { token, deviceId, userId } once approved,
 *        410 once expired or already-claimed (one-shot)
 *
 * All three endpoints 404 in self-host mode (no auth = nothing to pair to).
 */
import { deviceCodes, devices } from "@bridgehook/shared/db/schema";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/neon-http";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { checkDevicePair, loadUserAccess } from "../access.js";
import { type Auth, getSessionUser } from "../auth.js";
import { newDeviceId, newDeviceToken } from "../identity.js";
import { addMinutes } from "../time.js";

type DB = ReturnType<typeof drizzle>;

const DEVICE_CODE_TTL_MIN = 15;
const DEVICE_CODE_POLL_SEC = 5;
const DEVICE_KIND_RE = /^(extension|desktop|cli|web)$/;

// Avoid 0/O/1/I for less ambiguous human-typed codes.
const CODE_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codeChunk = customAlphabet(CODE_ALPHA, 4);
function makeDeviceCode(): string {
	return `DV-${codeChunk()}-${codeChunk()}`;
}

async function sha256Hex(input: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	const arr = new Uint8Array(buf);
	let out = "";
	for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
	return out;
}

export interface AuthDeviceEnv {
	auth: Auth;
	db: DB;
	webUrl: string;
}

export function buildAuthDeviceRoutes(getDeps: (c: { env: unknown }) => AuthDeviceEnv | null) {
	const app = new Hono();

	// ── 1. Extension begins pairing ────────────────────────────────────────
	app.post("/start", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
		const { kind, labelHint, os, userAgent } = body as {
			kind?: unknown;
			labelHint?: unknown;
			os?: unknown;
			userAgent?: unknown;
		};

		if (typeof kind !== "string" || !DEVICE_KIND_RE.test(kind)) {
			return c.json({ error: "kind must be 'extension'|'desktop'|'cli'|'web'" }, 400);
		}

		// labelHint, os, userAgent are advisory — bound the size, accept anything.
		const safeLabelHint =
			typeof labelHint === "string" && labelHint.length > 0 ? labelHint.slice(0, 96) : null;
		// os and userAgent are exposed back as advisory; the device row also stores them
		// after the exchange step.
		void os;
		void userAgent;

		// Generate a unique code. Collisions vanishingly rare; loop a few times defensively.
		let code: string | null = null;
		for (let i = 0; i < 5 && code === null; i++) {
			const candidate = makeDeviceCode();
			try {
				await deps.db.insert(deviceCodes).values({
					code: candidate,
					kind,
					labelHint: safeLabelHint,
					status: "pending",
					expiresAt: addMinutes(new Date(), DEVICE_CODE_TTL_MIN),
				});
				code = candidate;
			} catch {
				// PK collision; try again.
			}
		}
		if (!code) {
			return c.json({ error: "Could not allocate device code, try again" }, 500);
		}

		const verificationUrl = `${deps.webUrl.replace(/\/$/, "")}/connect?code=${encodeURIComponent(code)}`;

		return c.json({
			deviceCode: code,
			verificationUrl,
			pollInterval: DEVICE_CODE_POLL_SEC,
			expiresIn: DEVICE_CODE_TTL_MIN * 60,
		});
	});

	// ── 2. Web user approves a pending code (session-authed) ───────────────
	app.post("/approve", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
		const code = (body as { code?: unknown }).code;
		if (typeof code !== "string" || !/^DV-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
			return c.json({ error: "Invalid code format" }, 400);
		}

		const [row] = await deps.db
			.select()
			.from(deviceCodes)
			.where(eq(deviceCodes.code, code))
			.limit(1);
		if (!row) return c.json({ error: "Code not found" }, 404);
		if (row.expiresAt.getTime() < Date.now()) {
			return c.json({ error: "Code expired" }, 410);
		}
		if (row.status === "approved") {
			return c.json({ error: "Code already approved" }, 409);
		}

		// Plan / quota gate — fail at approve so the web user sees a clear
		// "device limit reached" message before the extension ever exchanges.
		const access = await loadUserAccess(deps.db, sessionUser.id);
		if (!access) return c.json({ error: "User not found" }, 404);
		const gate = await checkDevicePair(deps.db, access);
		if (!gate.ok) return c.json({ error: gate.error, code: "quota" }, gate.status);

		await deps.db
			.update(deviceCodes)
			.set({ status: "approved", approvedUserId: sessionUser.id })
			.where(eq(deviceCodes.code, code));

		return c.json({ ok: true, kind: row.kind, labelHint: row.labelHint });
	});

	// ── 3. Extension claims the token (one-shot) ───────────────────────────
	app.post("/exchange", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Auth not configured" }, 404);

		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
		const code = (body as { code?: unknown }).code;
		if (typeof code !== "string" || !/^DV-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
			return c.json({ error: "Invalid code format" }, 400);
		}

		const [row] = await deps.db
			.select()
			.from(deviceCodes)
			.where(eq(deviceCodes.code, code))
			.limit(1);
		if (!row) return c.json({ error: "Code expired or already claimed" }, 410);
		if (row.expiresAt.getTime() < Date.now()) {
			// Best-effort cleanup — cron also handles this.
			await deps.db
				.delete(deviceCodes)
				.where(eq(deviceCodes.code, code))
				.catch(() => {});
			return c.json({ error: "Code expired" }, 410);
		}
		if (row.status !== "approved" || !row.approvedUserId) {
			return c.json({ status: "pending" }, 202);
		}

		// Defensive re-check at exchange time — the user could have hit
		// their device cap between approve and exchange (e.g. paired another
		// device in a parallel tab), or had their plan downgraded.
		const access = await loadUserAccess(deps.db, row.approvedUserId);
		if (!access) {
			await deps.db.delete(deviceCodes).where(eq(deviceCodes.code, code));
			return c.json({ error: "User not found" }, 404);
		}
		const gate = await checkDevicePair(deps.db, access);
		if (!gate.ok) {
			// Consume the code so the extension stops polling on a doomed flow.
			await deps.db.delete(deviceCodes).where(eq(deviceCodes.code, code));
			return c.json({ error: gate.error, code: "quota" }, gate.status);
		}

		// Mint the device + token. The device row is the persistent record;
		// the device_codes row is consumed.
		const token = newDeviceToken();
		const tokenHash = await sha256Hex(token);
		const deviceId = newDeviceId();
		const label =
			row.labelHint && row.labelHint.trim().length > 0
				? row.labelHint.trim().slice(0, 96)
				: `${row.kind} device`;

		await deps.db.insert(devices).values({
			id: deviceId,
			userId: row.approvedUserId,
			kind: row.kind,
			label,
			tokenHash,
			lastSeenAt: new Date(),
		});

		// Consume the code (one-shot).
		await deps.db.delete(deviceCodes).where(eq(deviceCodes.code, code));

		return c.json({
			token,
			deviceId,
			userId: row.approvedUserId,
			label,
			kind: row.kind,
		});
	});

	return app;
}

/**
 * Cron-friendly cleanup helper — delete expired or stale device codes.
 * Called from the worker's scheduled handler.
 */
export async function cleanupExpiredDeviceCodes(db: DB): Promise<number> {
	const result = await db
		.delete(deviceCodes)
		.where(lt(deviceCodes.expiresAt, new Date()))
		.returning({ code: deviceCodes.code });
	return result.length;
}

// Suppress unused-import warning for `and`/`isNull`/`sql` — kept available
// for future filtering; trim if unused after subsequent commits.
void and;
void isNull;
void sql;
