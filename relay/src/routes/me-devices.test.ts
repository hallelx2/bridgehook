/**
 * Device revocation against a real D1 (Miniflare). A browser session may
 * revoke any device on its account; a device token may revoke only itself,
 * which is what `bridgehook logout` relies on.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as schema from "@bridgehook/shared/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Auth } from "../auth.js";
import type { DB } from "../db.js";
import { buildMeDevicesRoutes } from "./me-devices.js";
import { buildMeRoutes } from "./me.js";

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

async function sha256Hex(input: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const TOKENS = {
	aliceCli: `dvc_${"a".repeat(32)}`,
	aliceExt: `dvc_${"b".repeat(32)}`,
	bobCli: `dvc_${"c".repeat(32)}`,
};
const IDS = {
	aliceCli: `dev_${"a".repeat(20)}`,
	aliceExt: `dev_${"b".repeat(20)}`,
	bobCli: `dev_${"c".repeat(20)}`,
};

beforeEach(async () => {
	await d1.prepare("DELETE FROM devices").run();
	await d1.prepare("DELETE FROM user").run();
	for (const id of ["u_alice", "u_bob"]) {
		await d1
			.prepare("INSERT INTO user (id, name, email, plan) VALUES (?, ?, ?, 'free')")
			.bind(id, id, `${id}@example.com`)
			.run();
	}
	const rows: [keyof typeof IDS, string, string][] = [
		["aliceCli", "u_alice", "cli"],
		["aliceExt", "u_alice", "extension"],
		["bobCli", "u_bob", "cli"],
	];
	for (const [k, user, kind] of rows) {
		await d1
			.prepare(
				"INSERT INTO devices (id, user_id, kind, label, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.bind(IDS[k], user, kind, k, await sha256Hex(TOKENS[k]), Date.now())
			.run();
	}
});

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

const app = () => buildMeDevicesRoutes(() => ({ auth: fakeAuth(), db }));

const del = (id: string, headers: Record<string, string>) =>
	app().request(`/${id}`, { method: "DELETE", headers });

async function revoked(id: string): Promise<boolean> {
	const row = await d1
		.prepare("SELECT revoked_at FROM devices WHERE id = ?")
		.bind(id)
		.first<{ revoked_at: number | null }>();
	return row?.revoked_at != null;
}

describe("DELETE /api/me/devices/:id", () => {
	it("lets a device token revoke its own device, after which the token stops working", async () => {
		const res = await del(IDS.aliceCli, { authorization: `Bearer ${TOKENS.aliceCli}` });
		expect(res.status).toBe(200);
		expect(await revoked(IDS.aliceCli)).toBe(true);

		const again = await del(IDS.aliceCli, { authorization: `Bearer ${TOKENS.aliceCli}` });
		expect(again.status).toBe(401);
	});

	it("refuses a device token revoking another device, even on the same account", async () => {
		const res = await del(IDS.aliceExt, { authorization: `Bearer ${TOKENS.aliceCli}` });
		expect(res.status).toBe(403);
		expect(await revoked(IDS.aliceExt)).toBe(false);

		const other = await del(IDS.bobCli, { authorization: `Bearer ${TOKENS.aliceCli}` });
		expect(other.status).toBe(403);
		expect(await revoked(IDS.bobCli)).toBe(false);
	});

	it("still lets a session revoke any of its own devices but not another user's", async () => {
		expect((await del(IDS.aliceExt, { "x-test-user": "u_alice" })).status).toBe(200);
		expect(await revoked(IDS.aliceExt)).toBe(true);
		expect((await del(IDS.bobCli, { "x-test-user": "u_alice" })).status).toBe(404);
		expect(await revoked(IDS.bobCli)).toBe(false);
	});

	it("answers 401 with no credentials", async () => {
		expect((await del(IDS.aliceCli, {})).status).toBe(401);
	});
});

describe("PATCH /api/me/channels/:id with a device token", () => {
	const meApp = () =>
		buildMeRoutes(() => ({
			auth: fakeAuth(),
			db,
			notifier: {
				getChannelDO: () => ({ fetch: async () => new Response("") }),
				notifyUser: () => {},
			},
			tunnelDomain: null,
		}));
	const patch = (id: string, body: unknown, headers: Record<string, string>) =>
		meApp().request(`/channels/${id}`, {
			method: "PATCH",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(body),
		});
	const row = (id: string) =>
		d1
			.prepare("SELECT allowed_paths, label FROM channels WHERE id = ?")
			.bind(id)
			.first<{ allowed_paths: string; label: string | null }>();
	const bearer = { authorization: `Bearer ${TOKENS.aliceCli}` };

	beforeEach(async () => {
		await d1.prepare("DELETE FROM channels").run();
		for (const [id, user] of [
			["chalice", "u_alice"],
			["chbob", "u_bob"],
		]) {
			await d1
				.prepare(
					"INSERT INTO channels (id, public_key, port, user_id, created_at) VALUES (?, ?, 3000, ?, ?)",
				)
				.bind(id, "04".padEnd(130, "a"), user, Date.now())
				.run();
		}
	});

	it("sets allowedPaths on the token owner's channel", async () => {
		const res = await patch("chalice", { allowedPaths: ["/stripe"] }, bearer);
		expect(res.status).toBe(200);
		expect((await row("chalice"))?.allowed_paths).toBe('["/stripe"]');
	});

	it("refuses any other field, and another user's channel", async () => {
		expect((await patch("chalice", { label: "x" }, bearer)).status).toBe(403);
		expect((await row("chalice"))?.label).toBeNull();
		expect(
			(await patch("chalice", { allowedPaths: ["/a"], responseMode: "sync" }, bearer)).status,
		).toBe(403);
		expect((await row("chalice"))?.allowed_paths).toBe("[]");
		expect((await patch("chbob", { allowedPaths: ["/x"] }, bearer)).status).toBe(404);
		expect((await row("chbob"))?.allowed_paths).toBe("[]");
	});

	it("still lets a session change the label", async () => {
		expect((await patch("chalice", { label: "api" }, { "x-test-user": "u_alice" })).status).toBe(
			200,
		);
		expect((await row("chalice"))?.label).toBe("api");
	});
});
