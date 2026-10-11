import { scryptSync } from "node:crypto";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it, vi } from "vitest";

// Count scrypt calls made by password.ts, so "every failed sign-in costs the
// same" is checked as a count of the expensive step, not a wall-clock ratio
// that a loaded machine can skew.
const scryptCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("node:crypto", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:crypto")>();
	return {
		...actual,
		scrypt: (...args: Parameters<typeof actual.scrypt>) => {
			scryptCalls.n++;
			return (actual.scrypt as (...a: unknown[]) => void)(...args);
		},
	};
});
import { rehashOnSignIn } from "./password-rehash.js";
import {
	SCRYPT_PARAMS,
	hashPassword,
	needsRehash,
	verifyPassword,
	wrapLegacyHash,
} from "./password.js";

// Builds a hash the way the launch code did (10,000 iterations), independently
// of password.ts, so the tests do not trust the module they are checking.
async function legacyHash(password: string, iterations = 10_000): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
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
		256,
	);
	const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
	return `pbkdf2-sha256$${iterations}$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}

const schemeOf = (hash: string) => hash.split("$")[0];

describe("password hashing", () => {
	it("hashes new passwords with scrypt at OWASP's N=2^14, r=8, p=5", async () => {
		expect(SCRYPT_PARAMS).toEqual({ N: 16_384, r: 8, p: 5 });
		const hash = await hashPassword("correct horse battery");
		const [scheme, N, r, p, saltHex, keyHex] = hash.split("$");
		expect([scheme, N, r, p]).toEqual(["scrypt", "16384", "8", "5"]);
		// Recompute with Node's scrypt, independent of password.ts.
		const expected = scryptSync("correct horse battery", Buffer.from(saltHex, "hex"), 32, {
			N: 16_384,
			r: 8,
			p: 5,
			maxmem: 64 * 1024 * 1024,
		});
		expect(keyHex).toBe(expected.toString("hex"));
		expect(await verifyPassword({ password: "correct horse battery", hash })).toBe(true);
		expect(await verifyPassword({ password: "wrong password", hash })).toBe(false);
	});

	it("still verifies hashes made at the launch cost", async () => {
		const hash = await legacyHash("correct horse battery");
		expect(await verifyPassword({ password: "correct horse battery", hash })).toBe(true);
		expect(await verifyPassword({ password: "wrong password", hash })).toBe(false);
	});

	it("rejects tampered or out-of-range hashes without throwing", async () => {
		const good = await hashPassword("pw-123456");
		const parts = good.split("$");
		const variants = [
			"not-a-hash",
			"scrypt$1$aa$bb",
			["scrypt", "1000", ...parts.slice(2)].join("$"), // N not a power of two
			["scrypt", String(2 ** 20), ...parts.slice(2)].join("$"), // N above the bound
			["scrypt", "131072", "15", ...parts.slice(3)].join("$"), // ~240 MiB, over the isolate
			["scrypt", "65536", "8", ...parts.slice(3)].join("$"), // 64 MiB, at the memory cap
			[...parts.slice(0, 4), "zz", parts[5]].join("$"), // bad salt hex
			"pbkdf2-sha256$600000$00$00", // above Workers' PBKDF2 cap
		];
		for (const hash of variants) {
			expect(await verifyPassword({ password: "pw-123456", hash })).toBe(false);
		}
	});

	it("flags legacy PBKDF2 and weaker scrypt hashes for rehash, nothing else", async () => {
		expect(needsRehash(await legacyHash("pw-123456"))).toBe(true);
		expect(needsRehash(await hashPassword("pw-123456"))).toBe(false);
		const weaker = (await hashPassword("pw-123456")).replace("$16384$8$5$", "$1024$8$1$");
		expect(needsRehash(weaker)).toBe(true);
		expect(needsRehash("not-a-hash")).toBe(false);
		expect(needsRehash("bcrypt$1$aa$bb")).toBe(false);
		expect(needsRehash("pbkdf2-sha256$abc$aa$bb")).toBe(false);
	});
});

describe("wrapping legacy hashes", () => {
	it("wraps a PBKDF2 hash as scrypt without the password, and the wrap verifies", async () => {
		const legacy = await legacyHash("correct horse battery");
		const wrapped = await wrapLegacyHash(legacy);
		expect(wrapped?.split("$").slice(0, 2)).toEqual(["scrypt-pbkdf2", "10000"]);
		const hash = String(wrapped);
		expect(await verifyPassword({ password: "correct horse battery", hash })).toBe(true);
		expect(await verifyPassword({ password: "wrong password", hash })).toBe(false);
		expect(needsRehash(hash)).toBe(true);
	});

	it("only wraps plain legacy hashes", async () => {
		expect(await wrapLegacyHash(await hashPassword("pw-123456"))).toBeNull();
		const wrapped = String(await wrapLegacyHash(await legacyHash("pw-123456")));
		expect(await wrapLegacyHash(wrapped)).toBeNull();
		expect(await wrapLegacyHash("not-a-hash")).toBeNull();
	});

	it("spends exactly one scrypt on every failed sign-in path", async () => {
		// Better-Auth runs hashPassword() for an unknown email and verifyPassword()
		// for an account. Before the fix a legacy account ran no scrypt at all
		// (a 10k PBKDF2 only), which made it ~35x cheaper and told the accounts apart.
		const legacy = await legacyHash("correct horse battery");
		const wrapped = String(await wrapLegacyHash(legacy));
		const current = await hashPassword("correct horse battery");
		const scryptsFor = async (fn: () => Promise<unknown>) => {
			scryptCalls.n = 0;
			await fn();
			return scryptCalls.n;
		};
		expect(await scryptsFor(() => hashPassword("guess-1234"))).toBe(1);
		expect(await scryptsFor(() => verifyPassword({ password: "guess-1234", hash: current }))).toBe(
			1,
		);
		expect(await scryptsFor(() => verifyPassword({ password: "guess-1234", hash: legacy }))).toBe(
			1,
		);
		expect(await scryptsFor(() => verifyPassword({ password: "guess-1234", hash: wrapped }))).toBe(
			1,
		);
	});
});

describe("rehash on sign-in", () => {
	function makeAuth() {
		const db: Record<string, Record<string, unknown>[]> = {
			user: [],
			session: [],
			account: [],
			verification: [],
		};
		const auth = betterAuth({
			secret: "test-secret-test-secret-test-secret-0",
			baseURL: "http://localhost:8787",
			basePath: "/auth",
			database: memoryAdapter(db),
			emailAndPassword: {
				enabled: true,
				password: { hash: hashPassword, verify: verifyPassword },
			},
			hooks: { after: rehashOnSignIn },
		});
		return { auth, db };
	}

	async function post(auth: ReturnType<typeof makeAuth>["auth"], path: string, body: unknown) {
		return auth.handler(
			new Request(`http://localhost:8787/auth${path}`, {
				method: "POST",
				headers: { "content-type": "application/json", origin: "http://localhost:8787" },
				body: JSON.stringify(body),
			}),
		);
	}

	const email = "legacy@example.com";
	const password = "correct horse battery";

	async function seedLegacyUser() {
		const ctx = makeAuth();
		const res = await post(ctx.auth, "/sign-up/email", { email, password, name: "Legacy" });
		expect(res.status).toBe(200);
		const account = ctx.db.account.find((a) => a.providerId === "credential");
		if (!account) throw new Error("credential account not created");
		account.password = await legacyHash(password);
		return { ...ctx, account };
	}

	it("rewrites a 10,000-iteration PBKDF2 hash as scrypt after a correct sign-in", async () => {
		const { auth, account } = await seedLegacyUser();
		const res = await post(auth, "/sign-in/email", { email, password });
		expect(res.status).toBe(200);
		const stored = String(account.password);
		expect(schemeOf(stored)).toBe("scrypt");
		expect(needsRehash(stored)).toBe(false);
		expect(await verifyPassword({ password, hash: stored })).toBe(true);
	});

	it("replaces a wrapped legacy hash with plain scrypt after a correct sign-in", async () => {
		const { auth, account } = await seedLegacyUser();
		account.password = await wrapLegacyHash(String(account.password));
		const res = await post(auth, "/sign-in/email", { email, password });
		expect(res.status).toBe(200);
		const stored = String(account.password);
		expect(schemeOf(stored)).toBe("scrypt");
		expect(await verifyPassword({ password, hash: stored })).toBe(true);
	});

	it("leaves the hash alone after a wrong password", async () => {
		const { auth, account } = await seedLegacyUser();
		const before = String(account.password);
		const res = await post(auth, "/sign-in/email", { email, password: "wrong password!" });
		expect(res.status).toBe(401);
		expect(account.password).toBe(before);
	});

	it("does not rewrite a hash that is already at full strength", async () => {
		const { auth, db } = makeAuth();
		await post(auth, "/sign-up/email", { email, password, name: "Current" });
		const account = db.account.find((a) => a.providerId === "credential");
		const before = String(account?.password);
		expect(schemeOf(before)).toBe("scrypt");
		const res = await post(auth, "/sign-in/email", { email, password });
		expect(res.status).toBe(200);
		expect(account?.password).toBe(before);
	});
});
