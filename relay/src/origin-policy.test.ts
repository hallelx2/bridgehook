import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
	type OriginPolicyEnv,
	checkOrigin,
	corsHeaders,
	originPolicy,
	trustedOrigins,
} from "./origin-policy.js";

const ENV: OriginPolicyEnv = {
	AUTH_TRUSTED_ORIGINS: "https://bridgehook-web.pages.dev, https://app.bridgehook.dev/ ,junk",
	WEB_URL: "https://bridgehook-web.pages.dev/dashboard",
	BETTER_AUTH_URL: "https://relay.bridgehook.dev",
};
const TRUSTED = "https://app.bridgehook.dev";
const EVIL = "https://evil.example";
const SESSION = "__Secure-better-auth.session_token=abc.def; theme=dark";

describe("trustedOrigins", () => {
	it("normalises the env list and WEB_URL/BETTER_AUTH_URL to origins, dropping junk", () => {
		expect([...trustedOrigins(ENV)].sort()).toEqual([
			"https://app.bridgehook.dev",
			"https://bridgehook-web.pages.dev",
			"https://relay.bridgehook.dev",
		]);
	});

	it("is empty when nothing is configured", () => {
		expect(trustedOrigins({}).size).toBe(0);
	});
});

describe("corsHeaders", () => {
	const t = trustedOrigins(ENV);

	it("echoes a trusted origin with credentials", () => {
		expect(corsHeaders(TRUSTED, t)).toMatchObject({
			"Access-Control-Allow-Origin": TRUSTED,
			"Access-Control-Allow-Credentials": "true",
		});
	});

	it("gives untrusted origins a wildcard without credentials", () => {
		const h = corsHeaders(EVIL, t);
		expect(h["Access-Control-Allow-Origin"]).toBe("*");
		expect(h["Access-Control-Allow-Credentials"]).toBeUndefined();
	});
});

describe("checkOrigin", () => {
	const t = trustedOrigins(ENV);
	const req = (over: Partial<Parameters<typeof checkOrigin>[0]>) => ({
		method: "POST",
		path: "/api/me/devices/self-register",
		origin: EVIL,
		cookie: SESSION,
		...over,
	});

	it("refuses a cross-site POST carrying the session cookie", () => {
		expect(checkOrigin(req({}), t).ok).toBe(false);
	});

	it("refuses the sandboxed-iframe 'null' origin", () => {
		expect(checkOrigin(req({ origin: "null" }), t).ok).toBe(false);
	});

	it("refuses DELETE and PATCH too", () => {
		expect(checkOrigin(req({ method: "DELETE", path: "/api/me/channels/abc" }), t).ok).toBe(false);
		expect(checkOrigin(req({ method: "PATCH", path: "/api/me/channels/abc" }), t).ok).toBe(false);
	});

	it("covers device approval and the non-secure cookie name", () => {
		const r = req({ path: "/auth/device/approve", cookie: "better-auth.session_token=x" });
		expect(checkOrigin(r, t).ok).toBe(false);
	});

	it("allows trusted origins", () => {
		expect(checkOrigin(req({ origin: TRUSTED }), t).ok).toBe(true);
	});

	it("allows browser extensions (governed by host permissions)", () => {
		expect(checkOrigin(req({ origin: "chrome-extension://abcdefghijklmnop" }), t).ok).toBe(true);
	});

	it("allows non-browser callers with no Origin", () => {
		expect(checkOrigin(req({ origin: null }), t).ok).toBe(true);
	});

	it("ignores requests without the session cookie", () => {
		expect(checkOrigin(req({ cookie: null }), t).ok).toBe(true);
		expect(checkOrigin(req({ cookie: "theme=dark" }), t).ok).toBe(true);
	});

	it("ignores safe methods", () => {
		expect(checkOrigin(req({ method: "GET" }), t).ok).toBe(true);
	});

	it("exempts webhook intake and the Polar webhook", () => {
		expect(checkOrigin(req({ path: "/hook/abc123" }), t).ok).toBe(true);
		expect(checkOrigin(req({ path: "/hook/abc123/response" }), t).ok).toBe(true);
		expect(checkOrigin(req({ path: "/api/billing/webhook" }), t).ok).toBe(true);
	});
});

describe("originPolicy middleware", () => {
	const app = new Hono<{ Bindings: OriginPolicyEnv }>();
	app.use("*", originPolicy());
	app.get("/api/me", (c) => c.json({ user: "secret" }));
	app.post("/api/me/devices/self-register", (c) => c.json({ token: "dvc_x" }));
	app.post("/hook/:id", (c) => c.json({ received: true }, 202));

	it("preflight from an untrusted origin gets no credentials", async () => {
		const res = await app.request(
			"/api/me",
			{
				method: "OPTIONS",
				headers: { Origin: EVIL, "Access-Control-Request-Method": "GET" },
			},
			ENV,
		);
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(res.headers.get("access-control-allow-credentials")).toBeNull();
	});

	it("preflight from a trusted origin is credentialed", async () => {
		const res = await app.request(
			"/api/me",
			{
				method: "OPTIONS",
				headers: { Origin: TRUSTED, "Access-Control-Request-Method": "POST" },
			},
			ENV,
		);
		expect(res.headers.get("access-control-allow-origin")).toBe(TRUSTED);
		expect(res.headers.get("access-control-allow-credentials")).toBe("true");
	});

	it("blocks the one-request token theft: cross-site simple POST with cookie", async () => {
		const res = await app.request(
			"/api/me/devices/self-register",
			{
				method: "POST",
				headers: { Origin: EVIL, Cookie: SESSION, "Content-Type": "text/plain" },
				body: JSON.stringify({ kind: "extension" }),
			},
			ENV,
		);
		expect(res.status).toBe(403);
		expect(await res.text()).not.toContain("dvc_");
	});

	it("lets the trusted dashboard through with credentialed CORS", async () => {
		const res = await app.request(
			"/api/me/devices/self-register",
			{
				method: "POST",
				headers: { Origin: TRUSTED, Cookie: SESSION, "Content-Type": "application/json" },
				body: "{}",
			},
			ENV,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("access-control-allow-origin")).toBe(TRUSTED);
		expect(res.headers.get("access-control-allow-credentials")).toBe("true");
	});

	it("an untrusted GET response is not credential-readable", async () => {
		const res = await app.request("/api/me", { headers: { Origin: EVIL, Cookie: SESSION } }, ENV);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(res.headers.get("access-control-allow-credentials")).toBeNull();
	});

	it("webhook intake from any page still works", async () => {
		const res = await app.request(
			"/hook/abc123",
			{ method: "POST", headers: { Origin: EVIL, Cookie: SESSION }, body: "{}" },
			ENV,
		);
		expect(res.status).toBe(202);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
	});

	it("re-wraps immutable proxied responses instead of throwing", async () => {
		const proxied = new Hono<{ Bindings: OriginPolicyEnv }>();
		proxied.use("*", originPolicy());
		proxied.get("/api/me/stream", async () => {
			const r = await fetch("data:text/plain,hello");
			return r; // fetch() responses have immutable headers
		});
		const res = await proxied.request("/api/me/stream", { headers: { Origin: TRUSTED } }, ENV);
		expect(res.headers.get("access-control-allow-origin")).toBe(TRUSTED);
		expect(await res.text()).toBe("hello");
	});
});
