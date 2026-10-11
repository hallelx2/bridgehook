/**
 * Password hashing for Better-Auth on Cloudflare Workers.
 *
 * New hashes use scrypt (memory-hard) through the runtime's native
 * `node:crypto` implementation, at one of OWASP's recommended settings:
 * N=2^14, r=8, p=5 (16 MiB per hash). Measured on production Workers on
 * 2026-10-11 at 168–243 ms of CPU per hash.
 *
 * Why not PBKDF2 at OWASP's 600,000 iterations: production Workers refuse
 * PBKDF2 above 100,000 iterations ("iteration counts above 100000 are not
 * supported"; measured 2026-10-11, while local workerd accepts any count).
 * scrypt at the setting above is the strongest option OWASP lists that
 * fits the 128 MB isolate.
 *
 * History: the relay launched with PBKDF2-SHA256 at 10,000 iterations to
 * fit the free plan's 10 ms CPU budget. Those hashes still verify; the
 * after-hook in ./password-rehash.ts rewrites them as scrypt on the next
 * successful sign-in.
 *
 * Legacy hashes are wrapped in place by scripts/wrap-legacy-hashes.ts:
 * scrypt is run over the stored PBKDF2 output, so every account gets
 * scrypt's strength at once, without waiting for its owner to sign in.
 * Until a row is wrapped, verifying a plain PBKDF2 hash also spends one
 * scrypt, so a failed sign-in costs the same whatever kind of account (or
 * no account) the email belongs to.
 *
 * Hash formats (self-describing, so parameters can change later):
 *   scrypt$<N>$<r>$<p>$<salt>$<key>                                current
 *   scrypt-pbkdf2$<iters>$<psalt>$<N>$<r>$<p>$<salt>$<key>         wrapped legacy
 *   pbkdf2-sha256$<iters>$<salt>$<key>                             legacy, verify only
 * Salts and keys are hex.
 */
import { scrypt } from "node:crypto";

export const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 5 } as const;
const SCRYPT_PREFIX = "scrypt";
const WRAPPED_PREFIX = "scrypt-pbkdf2";
const PBKDF2_PREFIX = "pbkdf2-sha256";
const SALT_BYTES = 16;
const KEY_BYTES = 32;

// Bounds on parameters read back from stored hashes, so a tampered row
// cannot make verification allocate or spin without limit.
const SCRYPT_MAX_N = 131_072;
const SCRYPT_MAX_R = 16;
const SCRYPT_MAX_P = 16;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const PBKDF2_MIN_ITERS = 1_000;
// Production Workers reject PBKDF2 above 100,000 iterations.
const PBKDF2_MAX_ITERS = 100_000;

function toHex(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
	return s;
}

// Workers' strict TS types want `Uint8Array<ArrayBuffer>` on crypto.subtle
// inputs, same as the helpers in relay/src/index.ts.
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
	if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error("Invalid hex");
	const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(new ArrayBuffer(n));
	crypto.getRandomValues(out);
	return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
	return mismatch === 0;
}

function deriveScrypt(
	password: string | Uint8Array,
	salt: Uint8Array,
	params: { N: number; r: number; p: number },
): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		scrypt(
			typeof password === "string" ? password.normalize("NFKC") : password,
			salt,
			KEY_BYTES,
			{ ...params, maxmem: SCRYPT_MAXMEM },
			(err, key) => (err ? reject(err) : resolve(new Uint8Array(key))),
		);
	});
}

async function derivePbkdf2(
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

type ScryptParams = { N: number; r: number; p: number };
type ParsedHash =
	| ({ kind: "scrypt"; salt: Uint8Array; key: Uint8Array } & ScryptParams)
	| ({
			kind: "wrapped";
			iters: number;
			pbkdf2Salt: Uint8Array<ArrayBuffer>;
			salt: Uint8Array;
			key: Uint8Array;
	  } & ScryptParams)
	| { kind: "pbkdf2"; iters: number; salt: Uint8Array<ArrayBuffer>; key: Uint8Array };

function isPowerOfTwo(n: number): boolean {
	return n > 1 && (n & (n - 1)) === 0;
}

function parseScryptParams(parts: string[]): ScryptParams | null {
	const [N, r, p] = parts.map(Number);
	if (!Number.isInteger(N) || !isPowerOfTwo(N) || N > SCRYPT_MAX_N) return null;
	if (!Number.isInteger(r) || r < 1 || r > SCRYPT_MAX_R) return null;
	if (!Number.isInteger(p) || p < 1 || p > SCRYPT_MAX_P) return null;
	return { N, r, p };
}

function parseIters(raw: string): number | null {
	const iters = Number(raw);
	if (!Number.isInteger(iters) || iters < PBKDF2_MIN_ITERS || iters > PBKDF2_MAX_ITERS) return null;
	return iters;
}

function saltAndKey(saltHex: string, keyHex: string) {
	const salt = fromHex(saltHex);
	const key = fromHex(keyHex);
	if (salt.length !== SALT_BYTES || key.length !== KEY_BYTES) return null;
	return { salt, key };
}

function parseHash(hash: string): ParsedHash | null {
	const parts = hash.split("$");
	try {
		if (parts[0] === SCRYPT_PREFIX && parts.length === 6) {
			const params = parseScryptParams(parts.slice(1, 4));
			const sk = saltAndKey(parts[4], parts[5]);
			if (!params || !sk) return null;
			return { kind: "scrypt", ...params, ...sk };
		}
		if (parts[0] === WRAPPED_PREFIX && parts.length === 8) {
			const iters = parseIters(parts[1]);
			const pbkdf2Salt = fromHex(parts[2]);
			const params = parseScryptParams(parts.slice(3, 6));
			const sk = saltAndKey(parts[6], parts[7]);
			if (iters === null || pbkdf2Salt.length !== SALT_BYTES || !params || !sk) return null;
			return { kind: "wrapped", iters, pbkdf2Salt, ...params, ...sk };
		}
		if (parts[0] === PBKDF2_PREFIX && parts.length === 4) {
			const iters = parseIters(parts[1]);
			const sk = saltAndKey(parts[2], parts[3]);
			if (iters === null || !sk) return null;
			return { kind: "pbkdf2", iters, salt: sk.salt, key: sk.key };
		}
	} catch {
		return null;
	}
	return null;
}

function formatScrypt(params: ScryptParams, salt: Uint8Array, key: Uint8Array): string {
	return `${params.N}$${params.r}$${params.p}$${toHex(salt)}$${toHex(key)}`;
}

/**
 * Better-Auth `emailAndPassword.password.hash` callback. Returns the
 * serialized hash string stored in `account.password`.
 */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_BYTES);
	const key = await deriveScrypt(password, salt, SCRYPT_PARAMS);
	return `${SCRYPT_PREFIX}$${formatScrypt(SCRYPT_PARAMS, salt, key)}`;
}

/**
 * Better-Auth `emailAndPassword.password.verify` callback. Verifies current
 * scrypt hashes and legacy PBKDF2 hashes.
 *
 * Returns false (rather than throwing) on any parse error so an attacker
 * can't distinguish "wrong password" from "malformed hash" via error shape.
 */
export async function verifyPassword(args: {
	password: string;
	hash: string;
}): Promise<boolean> {
	const parsed = parseHash(args.hash);
	if (!parsed) return false;
	try {
		if (parsed.kind === "scrypt") {
			return constantTimeEqual(await deriveScrypt(args.password, parsed.salt, parsed), parsed.key);
		}
		if (parsed.kind === "wrapped") {
			const inner = await derivePbkdf2(args.password, parsed.pbkdf2Salt, parsed.iters);
			return constantTimeEqual(await deriveScrypt(inner, parsed.salt, parsed), parsed.key);
		}
		// Plain legacy PBKDF2: spend the same scrypt a current hash would, so a
		// wrong password costs the same as an unknown email or a current account.
		const actual = await derivePbkdf2(args.password, parsed.salt, parsed.iters);
		await deriveScrypt(actual, parsed.salt, SCRYPT_PARAMS);
		return constantTimeEqual(actual, parsed.key);
	} catch {
		return false;
	}
}

/**
 * True when a stored hash verifies under this module but is not what
 * {@link hashPassword} makes today: a legacy PBKDF2 hash (plain or wrapped),
 * or a scrypt hash with lower parameters. Malformed or foreign hashes return false:
 * they cannot verify, so there is nothing to upgrade.
 */
export function needsRehash(hash: string): boolean {
	const parsed = parseHash(hash);
	if (!parsed) return false;
	if (parsed.kind !== "scrypt") return true;
	return parsed.N < SCRYPT_PARAMS.N || parsed.r < SCRYPT_PARAMS.r || parsed.p < SCRYPT_PARAMS.p;
}

/**
 * Wraps a stored legacy PBKDF2 hash as scrypt over its PBKDF2 output, without
 * the password. Returns null for anything that is not a plain legacy hash.
 * Used by scripts/wrap-legacy-hashes.ts; the next successful sign-in then
 * replaces the wrapped hash with a plain scrypt one.
 */
export async function wrapLegacyHash(hash: string): Promise<string | null> {
	const parsed = parseHash(hash);
	if (!parsed || parsed.kind !== "pbkdf2") return null;
	const salt = randomBytes(SALT_BYTES);
	const key = await deriveScrypt(parsed.key, salt, SCRYPT_PARAMS);
	return `${WRAPPED_PREFIX}$${parsed.iters}$${toHex(parsed.salt)}$${formatScrypt(SCRYPT_PARAMS, salt, key)}`;
}
