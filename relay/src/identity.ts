/**
 * Identity resolution for relay routes.
 *
 * Three auth realms in BridgeHook:
 *   1. Session       — Better-Auth session cookie (web)
 *   2. Device token  — `Authorization: Bearer dvc_...` (extension, desktop, CLI)
 *   3. Channel ECDSA — per-channel signature (per-channel ops only)
 *
 * This module covers (1) and (2) — the user-realm helpers. The channel
 * ECDSA path stays in src/index.ts for now.
 *
 * In self-host mode (BETTER_AUTH_SECRET unset) the relay short-circuits to
 * a single implicit user via {@link getOrCreateSelfHostUser}.
 */
import { devices, user } from "@bridgehook/shared/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/neon-http";
import { customAlphabet } from "nanoid";
import { type Auth, getSessionUser } from "./auth.js";

type DB = ReturnType<typeof drizzle>;

const HEX = "0123456789abcdef";
const ALPHANUM = "0123456789abcdefghijklmnopqrstuvwxyz";
const nanoidHex = customAlphabet(HEX, 32);
const nanoidId = customAlphabet(ALPHANUM, 20);

/**
 * Generate a fresh opaque device token. Format: `dvc_` + 32 hex chars.
 * The plaintext is shown to the device exactly once; only its SHA-256 hash
 * is stored in `devices.token_hash`.
 */
export function newDeviceToken(): string {
	return `dvc_${nanoidHex()}`;
}

/** Generate a fresh device id: `dev_` + 20-char alphanumeric. */
export function newDeviceId(): string {
	return `dev_${nanoidId()}`;
}

/** Generate a fresh user id: `usr_` + 20-char alphanumeric. */
export function newUserId(): string {
	return `usr_${nanoidId()}`;
}

export interface ResolvedCaller {
	userId: string;
	deviceId: string | null;
	via: "session" | "device-token" | "self-host";
}

/**
 * SHA-256 hash a device token for DB lookup. Constant-time comparison is
 * provided by the unique index on `devices.token_hash`.
 */
async function hashToken(token: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	let out = "";
	const arr = new Uint8Array(buf);
	for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
	return out;
}

/**
 * Resolve caller identity by trying device token then session.
 * Returns null when neither is present or valid.
 *
 * Self-host mode (auth=null) is NOT handled here — callers should
 * short-circuit to {@link getOrCreateSelfHostUser} when auth is disabled.
 */
export async function resolveCaller(
	auth: Auth | null,
	db: DB,
	request: Request,
): Promise<ResolvedCaller | null> {
	// 1. Device token bearer
	const authHeader = request.headers.get("Authorization") || request.headers.get("authorization");
	if (authHeader) {
		const m = authHeader.match(/^Bearer\s+(dvc_[a-f0-9]{32})$/);
		if (m) {
			const tokenHash = await hashToken(m[1]);
			const [device] = await db
				.select()
				.from(devices)
				.where(and(eq(devices.tokenHash, tokenHash), isNull(devices.revokedAt)))
				.limit(1);
			if (device) {
				return { userId: device.userId, deviceId: device.id, via: "device-token" };
			}
		}
	}

	// 2. Better-Auth session cookie
	if (auth) {
		const sessionUser = await getSessionUser(auth, request);
		if (sessionUser) {
			return { userId: sessionUser.id, deviceId: null, via: "session" };
		}
	}

	return null;
}

/**
 * Self-host invariant: when auth is disabled, every channel attaches to a
 * single implicit user. Either the operator-configured SELF_HOST_USER_ID,
 * or an auto-created `self-host@local` user on first call.
 */
export async function getOrCreateSelfHostUser(
	db: DB,
	env: { SELF_HOST_USER_ID?: string },
): Promise<string> {
	if (env.SELF_HOST_USER_ID) return env.SELF_HOST_USER_ID;

	const [existing] = await db.select().from(user).where(eq(user.email, "self-host@local")).limit(1);
	if (existing) return existing.id;

	const id = newUserId();
	await db.insert(user).values({
		id,
		name: "Self-host",
		email: "self-host@local",
		emailVerified: true,
		plan: "active",
	});
	return id;
}

/**
 * Update a device's last_seen_at timestamp. Best-effort — failure doesn't
 * block the request. Called from authenticated routes that have a deviceId.
 */
export async function touchDevice(db: DB, deviceId: string): Promise<void> {
	try {
		await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, deviceId));
	} catch (err) {
		console.error("touchDevice failed:", err);
	}
}
