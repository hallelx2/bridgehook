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
	it("returns 429 with Retry-After once an IP passes the sign-in limit", async () => {
		const ip = fakeLimiter(3);
		const { hit } = makeApp({ RL_AUTH_IP: ip.limiter, RL_AUTH_EMAIL: fakeLimiter(100).limiter });
		const statuses = [];
		for (let i = 0; i < 5; i++) {
			statuses.push(
				(await hit("/auth/sign-in/email", { body: JSON.stringify({ email: `a${i}@x.com` }) }))
					.status,
			);
		}
		expect(statuses).toEqual([200, 200, 200, 429, 429]);
		const res = await hit("/auth/sign-up/email", { body: "{}" });
		expect(res.status).toBe(429);
		expect(res.headers.get("retry-after")).toBe("60");
		expect(await res.json()).toEqual({ error: "Too many requests. Try again in a minute." });
	});

	it("limits guesses at one email across many IPs", async () => {
		const email = fakeLimiter(2);
		const { hit } = makeApp({ RL_AUTH_IP: fakeLimiter(100).limiter, RL_AUTH_EMAIL: email.limiter });
		const statuses = [];
		for (let i = 0; i < 4; i++) {
			statuses.push(
				(
					await hit("/auth/sign-in/email", {
						ip: `192.0.2.${i}`,
						body: JSON.stringify({ email: " Victim@Example.com ", password: "guess" }),
					})
				).status,
			);
		}
		expect(statuses).toEqual([200, 200, 429, 429]);
		expect([...email.seen.keys()]).toEqual(["email:victim@example.com"]);
	});

	it("counts password-reset and magic-link sends per email too", async () => {
		const email = fakeLimiter(100);
		const { hit } = makeApp({ RL_AUTH_IP: fakeLimiter(100).limiter, RL_AUTH_EMAIL: email.limiter });
		await hit("/auth/request-password-reset", { body: JSON.stringify({ email: "r@x.com" }) });
		await hit("/auth/sign-in/magic-link", { body: JSON.stringify({ email: "m@x.com" }) });
		expect([...email.seen.keys()].sort()).toEqual(["email:m@x.com", "email:r@x.com"]);
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
			{ RL_AUTH_IP: fakeLimiter(10).limiter, RL_AUTH_EMAIL: fakeLimiter(10).limiter },
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
