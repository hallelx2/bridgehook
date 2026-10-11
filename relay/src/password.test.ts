import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { rehashOnSignIn } from "./password-rehash.js";
import { PBKDF2_ITERS, hashPassword, needsRehash, verifyPassword } from "./password.js";

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

const iterationsOf = (hash: string) => Number(hash.split("$")[1]);

describe("password hashing", () => {
	it("hashes new passwords at 600,000 iterations", async () => {
		expect(PBKDF2_ITERS).toBe(600_000);
		const hash = await hashPassword("correct horse battery");
		expect(iterationsOf(hash)).toBe(600_000);
		expect(await verifyPassword({ password: "correct horse battery", hash })).toBe(true);
		expect(await verifyPassword({ password: "wrong password", hash })).toBe(false);
	});

	it("still verifies hashes made at the launch cost", async () => {
		const hash = await legacyHash("correct horse battery");
		expect(await verifyPassword({ password: "correct horse battery", hash })).toBe(true);
		expect(await verifyPassword({ password: "wrong password", hash })).toBe(false);
	});

	it("flags only weaker hashes of our own format for rehash", async () => {
		expect(needsRehash(await legacyHash("pw-123456"))).toBe(true);
		expect(needsRehash(await hashPassword("pw-123456"))).toBe(false);
		expect(needsRehash("not-a-hash")).toBe(false);
		expect(needsRehash("scrypt$1$aa$bb")).toBe(false);
		expect(needsRehash("pbkdf2-sha256$abc$aa$bb")).toBe(false);
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

	it("rewrites a 10,000-iteration hash at 600,000 after a correct sign-in", async () => {
		const { auth, account } = await seedLegacyUser();
		const res = await post(auth, "/sign-in/email", { email, password });
		expect(res.status).toBe(200);
		const stored = String(account.password);
		expect(iterationsOf(stored)).toBe(600_000);
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
		expect(iterationsOf(before)).toBe(600_000);
		const res = await post(auth, "/sign-in/email", { email, password });
		expect(res.status).toBe(200);
		expect(account?.password).toBe(before);
	});
});
