/**
 * Device pairing against a real D1 (Miniflare runs workerd's SQLite), so the
 * concurrency tests exercise the same statements production runs.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as schema from "@bridgehook/shared/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Auth } from "../auth.js";
import type { DB } from "../db.js";
import { buildAuthDeviceRoutes } from "./auth-device.js";

let mf: Miniflare;
let d1: D1Database;
let db: DB;

const MIGRATIONS = join(__dirname, "../../migrations");

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: "export default { fetch() { return new Response('') } }",
		d1Databases: ["DB"],
	});
	d1 = (await mf.getD1Database("DB")) as unknown as D1Database;
	for (const file of readdirSync(MIGRATIONS)
		.filter((f) => f.endsWith(".sql"))
		.sort()) {
		const sql = readFileSync(join(MIGRATIONS, file), "utf8");
		for (const stmt of sql.split("--> statement-breakpoint")) {
			if (stmt.trim()) await d1.prepare(stmt).run();
		}
	}
	db = drizzle(d1, { schema }) as unknown as DB;
}, 30_000);

afterAll(async () => {
	await mf?.dispose();
});

beforeEach(async () => {
	await d1.prepare("DELETE FROM devices").run();
	await d1.prepare("DELETE FROM device_codes").run();
	await d1.prepare("DELETE FROM user").run();
	for (const id of ["u_alice", "u_bob"]) {
		await d1
			.prepare("INSERT INTO user (id, name, email, plan) VALUES (?, ?, ?, 'free')")
			.bind(id, id, `${id}@example.com`)
			.run();
	}
});

// getSessionUser only calls auth.api.getSession; the session is chosen per request.
function fakeAuth(): Auth {
	return {
		api: {
			getSession: async ({ headers }: { headers: Headers }) => {
				const id = headers.get("x-test-user");
				return id ? { user: { id, email: `${id}@example.com` } } : null;
			},
		},
	} as unknown as Auth;
}

function app() {
	return buildAuthDeviceRoutes(() => ({ auth: fakeAuth(), db, webUrl: "https://app.example" }));
}

const post = (a: ReturnType<typeof app>, path: string, body: unknown, user?: string) =>
	a.request(path, {
		method: "POST",
		headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
		body: JSON.stringify(body),
	});

async function seedCode(status: "pending" | "approved", approvedUserId: string | null) {
	const code = "DV-ABCD-EFGH";
	await d1
		.prepare(
			"INSERT INTO device_codes (code, kind, status, approved_user_id, expires_at) VALUES (?, 'extension', ?, ?, ?)",
		)
		.bind(code, status, approvedUserId, Date.now() + 10 * 60_000)
		.run();
	return code;
}

const count = async (table: string) =>
	Number((await d1.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n);

describe("device code exchange", () => {
	it("mints exactly one device when an approved code is exchanged concurrently", async () => {
		const code = await seedCode("approved", "u_alice");
		const a = app();
		const results = await Promise.all(
			Array.from({ length: 8 }, () => post(a, "/exchange", { code })),
		);
		const statuses = results.map((r) => r.status).sort();
		expect(statuses.filter((s) => s === 200)).toHaveLength(1);
		expect(statuses.filter((s) => s !== 200).every((s) => s === 410)).toBe(true);
		expect(await count("devices")).toBe(1);
		expect(await count("device_codes")).toBe(0);
	});

	it("answers 202 while pending, then 200 once, then 410", async () => {
		const code = await seedCode("pending", null);
		const a = app();
		expect((await post(a, "/exchange", { code })).status).toBe(202);
		expect((await post(a, "/approve", { code }, "u_alice")).status).toBe(200);
		const ok = await post(a, "/exchange", { code });
		expect(ok.status).toBe(200);
		const body = (await ok.json()) as { token: string; userId: string };
		expect(body.userId).toBe("u_alice");
		expect(body.token).toBeTruthy();
		expect((await post(a, "/exchange", { code })).status).toBe(410);
	});

	it("refuses an expired code without minting", async () => {
		const code = "DV-EXPI-REDD";
		await d1
			.prepare(
				"INSERT INTO device_codes (code, kind, status, approved_user_id, expires_at) VALUES (?, 'extension', 'approved', 'u_alice', ?)",
			)
			.bind(code, Date.now() - 1000)
			.run();
		expect((await post(app(), "/exchange", { code })).status).toBe(410);
		expect(await count("devices")).toBe(0);
	});
});

describe("device code approval", () => {
	it("lets exactly one of two users approve the same pending code", async () => {
		const code = await seedCode("pending", null);
		const a = app();
		const [alice, bob] = await Promise.all([
			post(a, "/approve", { code }, "u_alice"),
			post(a, "/approve", { code }, "u_bob"),
		]);
		expect([alice.status, bob.status].sort()).toEqual([200, 409]);
		const winner = alice.status === 200 ? "u_alice" : "u_bob";
		const row = await d1
			.prepare("SELECT approved_user_id AS u FROM device_codes WHERE code = ?")
			.bind(code)
			.first<{ u: string }>();
		expect(row?.u).toBe(winner);
	});

	it("does not let a second approval overwrite the first", async () => {
		const code = await seedCode("pending", null);
		const a = app();
		expect((await post(a, "/approve", { code }, "u_alice")).status).toBe(200);
		expect((await post(a, "/approve", { code }, "u_bob")).status).toBe(409);
		const ok = await post(a, "/exchange", { code });
		expect(((await ok.json()) as { userId: string }).userId).toBe("u_alice");
	});
});
