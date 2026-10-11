/**
 * Password hashing for Better-Auth on Cloudflare Workers.
 *
 * PBKDF2-SHA256 via crypto.subtle (native to Workers, no dependencies) at
 * the OWASP 2023+ recommendation of 600,000 iterations. Better-Auth's
 * default scrypt is replaced because crypto.subtle runs natively, while
 * scrypt runs in JS on the isolate.
 *
 * History: launched at 10,000 iterations to fit the Workers free plan's
 * 10 ms CPU budget. Workers moved to the paid plan (30 s default CPU
 * budget) on 2026-10-02, so new hashes use 600,000. The iteration count
 * is baked into each hash string, so hashes made at the old cost still
 * verify; {@link needsRehash} flags them and ./password-rehash.ts rewrites
 * them at the current cost on the next successful sign-in.
 *
 * Hash format (versioned for forward-compat):
 *   pbkdf2-sha256$<iters>$<salt-hex>$<key-hex>
 */

const ALGO = "pbkdf2-sha256";
export const PBKDF2_ITERS = 600_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const MIN_ACCEPTED_ITERS = 1_000;
const MAX_ACCEPTED_ITERS = 1_000_000;

function toHex(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
	return s;
}

// Workers' strict TS types want `Uint8Array<ArrayBuffer>` on crypto.subtle
// inputs — same pattern as the helpers in relay/src/index.ts.
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
	if (hex.length % 2 !== 0) throw new Error("Invalid hex length");
	const buf = new ArrayBuffer(hex.length / 2);
	const out = new Uint8Array(buf);
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
	}
	return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
	const buf = new ArrayBuffer(n);
	const out = new Uint8Array(buf);
	crypto.getRandomValues(out);
	return out;
}

async function derive(
	password: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number,
): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt, iterations, hash: "SHA-256" },
		key,
		KEY_BYTES * 8,
	);
	return new Uint8Array(bits);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
	return mismatch === 0;
}

/**
 * Better-Auth `emailAndPassword.password.hash` callback. Returns the
 * serialized hash string suitable for storing in `account.password`.
 */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_BYTES);
	const key = await derive(password, salt, PBKDF2_ITERS);
	return `${ALGO}$${PBKDF2_ITERS}$${toHex(salt)}$${toHex(key)}`;
}

/**
 * Better-Auth `emailAndPassword.password.verify` callback. Accepts any
 * iteration count baked into the stored hash so we can bump
 * {@link PBKDF2_ITERS} later without invalidating existing users.
 *
 * Returns false (rather than throwing) on any parse error so an attacker
 * can't distinguish "wrong password" from "malformed hash" via timing
 * or error shape.
 */
export async function verifyPassword(args: {
	password: string;
	hash: string;
}): Promise<boolean> {
	const parts = args.hash.split("$");
	if (parts.length !== 4) return false;
	if (parts[0] !== ALGO) return false;

	const iters = Number(parts[1]);
	if (!Number.isInteger(iters) || iters < MIN_ACCEPTED_ITERS || iters > MAX_ACCEPTED_ITERS) {
		return false;
	}

	let salt: Uint8Array<ArrayBuffer>;
	let expected: Uint8Array<ArrayBuffer>;
	try {
		salt = fromHex(parts[2]);
		expected = fromHex(parts[3]);
	} catch {
		return false;
	}
	if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;

	const actual = await derive(args.password, salt, iters);
	return constantTimeEqual(actual, expected);
}

/**
 * True when a stored hash is ours and was made at fewer iterations than
 * {@link PBKDF2_ITERS}, so it should be rewritten after the next successful
 * sign-in. Malformed or foreign hashes return false: they cannot verify,
 * so there is nothing to upgrade.
 */
export function needsRehash(hash: string): boolean {
	const parts = hash.split("$");
	if (parts.length !== 4 || parts[0] !== ALGO) return false;
	const iters = Number(parts[1]);
	return Number.isInteger(iters) && iters >= MIN_ACCEPTED_ITERS && iters < PBKDF2_ITERS;
}
