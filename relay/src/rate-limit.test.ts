import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
	type RateLimitEnv,
	type RateLimiter,
	allowRequest,
	clientIp,
	rateLimitAuth,
	rateLimitRoute,
} from "./rate-limit.js";

// Counts calls per key and refuses past `limit`, like the Workers binding.
function fakeLimiter(limit: number) {
	const seen = new Map<string, number>();
	const limiter: RateLimiter = {
		async limit({ key }) {
			const n = (seen.get(key) ?? 0) + 1;
			seen.set(key, n);
			return { success: n <= limit };
		},
	};
	return { limiter, seen };
}

function makeApp(env: RateLimitEnv) {
	const app = new Hono<{ Bindings: RateLimitEnv }>();
	app.use("/auth/*", rateLimitAuth());
	app.use("/auth/device/start", rateLimitRoute("RL_DEVICE", "device-start"));
	app.use("/auth/device/exchange", rateLimitRoute("RL_DEVICE_EXCHANGE", "device-exchange"));
	app.all("*", (c) => c.json({ ok: true }));
	return {
		hit: (path: string, init: RequestInit & { ip?: string } = {}) =>
			app.request(
				path,
				{
					method: "POST",
					...init,
					headers: {
						"content-type": "application/json",
						"cf-connecting-ip": init.ip ?? "203.0.113.7",
						...(init.headers as Record<string, string> | undefined),
					},
				},
				env,
			),
	};
}

describe("clientIp", () => {
	it("uses CF-Connecting-IP and ignores a spoofable X-Forwarded-For", () => {
		const withCf = new Request("https://r.example", {
			headers: { "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": "1.2.3.4" },
		});
		expect(clientIp(withCf)).toBe("198.51.100.1");
		const xffOnly = new Request("https://r.example", { headers: { "x-forwarded-for": "1.2.3.4" } });
		expect(clientIp(xffOnly)).toBe("unknown");
	});
});

describe("allowRequest", () => {
	it("allows when the binding is missing or throws (self-host, dev)", async () => {
		expect(await allowRequest(undefined, "k")).toBe(true);
		const broken: RateLimiter = {
			limit: async () => {
				throw new Error("binding down");
			},
		};
		expect(await allowRequest(broken, "k")).toBe(true);
	});
});

describe("rateLimitAuth", () => {
	const generous = () => ({
		RL_AUTH_IP: fakeLimiter(1000).limiter,
		RL_AUTH_EMAIL_IP: fakeLimiter(1000).limiter,
		RL_SIGNIN_EMAIL: fakeLimiter(1000).limiter,
		RL_AUTH_MAIL: fakeLimiter(1000).limiter,
	});
	const signIn = (email: string, ip?: string) => ({
		ip,
		body: JSON.stringify({ email, password: "guess" }),
	});

	it("returns 429 with Retry-After once an IP passes the auth limit", async () => {
		const { hit } = makeApp({ ...generous(), RL_AUTH_IP: fakeLimiter(3).limiter });
		const statuses = [];
		for (let i = 0; i < 5; i++) {
			statuses.push((await hit("/auth/sign-in/email", signIn(`a${i}@x.com`))).status);
		}
		expect(statuses).toEqual([200, 200, 200, 429, 429]);
		const res = await hit("/auth/sign-up/email", { body: "{}" });
		expect(res.status).toBe(429);
		expect(res.headers.get("retry-after")).toBe("60");
		expect(await res.json()).toEqual({ error: "Too many requests. Try again in a minute." });
	});

	it("stops one IP guessing one account, keyed on the normalised email", async () => {
		const emailIp = fakeLimiter(2);
		const { hit } = makeApp({ ...generous(), RL_AUTH_EMAIL_IP: emailIp.limiter });
		const statuses = [];
		for (let i = 0; i < 4; i++) {
			statuses.push((await hit("/auth/sign-in/email", signIn(" Victim@Example.com "))).status);
		}
		expect(statuses).toEqual([200, 200, 429, 429]);
		expect([...emailIp.seen.keys()]).toEqual(["email-ip:victim@example.com|203.0.113.7"]);
		// Someone else, on another IP, signing in to the same account is unaffected.
		expect(
			(await hit("/auth/sign-in/email", signIn("victim@example.com", "198.51.100.9"))).status,
		).toBe(200);
	});

	it("caps password guessing spread across many IPs on a per-email counter", async () => {
		const signin = fakeLimiter(3);
		const { hit } = makeApp({ ...generous(), RL_SIGNIN_EMAIL: signin.limiter });
		const statuses = [];
		for (let i = 0; i < 5; i++) {
			statuses.push(
				(await hit("/auth/sign-in/email", signIn("victim@example.com", `192.0.2.${i}`))).status,
			);
		}
		expect(statuses).toEqual([200, 200, 200, 429, 429]);
		expect([...signin.seen.keys()]).toEqual(["signin:victim@example.com"]);
	});

	it("counts form-encoded and multipart sign-ins against the same email", async () => {
		const signin = fakeLimiter(100);
		const emailIp = fakeLimiter(100);
		const { hit } = makeApp({
			...generous(),
			RL_SIGNIN_EMAIL: signin.limiter,
			RL_AUTH_EMAIL_IP: emailIp.limiter,
		});
		await hit("/auth/sign-in/email", {
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "email=Victim%40Example.com&password=guess",
		});
		const multipart = new FormData();
		multipart.set("email", "victim@example.com");
		multipart.set("password", "guess");
		const app = new Hono<{ Bindings: RateLimitEnv }>();
		app.use("/auth/*", rateLimitAuth());
		app.post("/auth/sign-in/email", (c) => c.json({ ok: true }));
		await app.request(
			"/auth/sign-in/email",
			{ method: "POST", body: multipart, headers: { "cf-connecting-ip": "203.0.113.7" } },
			{ ...generous(), RL_SIGNIN_EMAIL: signin.limiter, RL_AUTH_EMAIL_IP: emailIp.limiter },
		);
		expect(signin.seen.get("signin:victim@example.com")).toBe(2);
		expect(emailIp.seen.get("email-ip:victim@example.com|203.0.113.7")).toBe(2);
	});

	it("keeps recovery open while password sign-in for that email is being flooded", async () => {
		const { hit } = makeApp({ ...generous(), RL_SIGNIN_EMAIL: fakeLimiter(0).limiter });
		expect((await hit("/auth/sign-in/email", signIn("victim@example.com"))).status).toBe(429);
		const reset = await hit("/auth/request-password-reset", {
			body: JSON.stringify({ email: "victim@example.com" }),
		});
		expect(reset.status).toBe(200);
		const magic = await hit("/auth/sign-in/magic-link", {
			body: JSON.stringify({ email: "victim@example.com" }),
		});
		expect(magic.status).toBe(200);
	});

	it("limits mail sends per email without touching password sign-in", async () => {
		const mail = fakeLimiter(2);
		const { hit } = makeApp({ ...generous(), RL_AUTH_MAIL: mail.limiter });
		const sends = [];
		for (const path of [
			"/auth/request-password-reset",
			"/auth/sign-in/magic-link",
			"/auth/forget-password",
		]) {
			sends.push((await hit(path, { body: JSON.stringify({ email: "Inbox@X.com" }) })).status);
		}
		expect(sends).toEqual([200, 200, 429]);
		expect([...mail.seen.keys()]).toEqual(["mail:inbox@x.com"]);
		expect((await hit("/auth/sign-in/email", signIn("inbox@x.com"))).status).toBe(200);
	});

	it("leaves session reads and device routes to their own limits", async () => {
		const ip = fakeLimiter(0);
		const { hit } = makeApp({ RL_AUTH_IP: ip.limiter });
		expect((await hit("/auth/get-session", { method: "GET" })).status).toBe(200);
		expect((await hit("/auth/device/approve", { body: "{}" })).status).toBe(200);
		expect(ip.seen.size).toBe(0);
	});

	it("still forwards the body the handler needs after reading the email", async () => {
		const app = new Hono<{ Bindings: RateLimitEnv }>();
		app.use("/auth/*", rateLimitAuth());
		app.post("/auth/sign-in/email", async (c) => c.json(await c.req.json()));
		const body = { email: "keep@x.com", password: "pw" };
		const res = await app.request(
			"/auth/sign-in/email",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			},
			generous(),
		);
		expect(await res.json()).toEqual(body);
	});
});

describe("rateLimitRoute", () => {
	it("limits device pairing per IP, each route on its own budget", async () => {
		const device = fakeLimiter(2);
		const exchange = fakeLimiter(4);
		const { hit } = makeApp({ RL_DEVICE: device.limiter, RL_DEVICE_EXCHANGE: exchange.limiter });
		const starts = [];
		for (let i = 0; i < 3; i++)
			starts.push((await hit("/auth/device/start", { body: "{}" })).status);
		expect(starts).toEqual([200, 200, 429]);
		const exchanges = [];
		for (let i = 0; i < 5; i++) {
			exchanges.push((await hit("/auth/device/exchange", { body: "{}" })).status);
		}
		expect(exchanges).toEqual([200, 200, 200, 200, 429]);
		expect([...device.seen.keys()]).toEqual(["device-start:203.0.113.7"]);
	});
});
