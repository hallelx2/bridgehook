import { describe, expect, it } from "vitest";
import {
	buildWebhookUrl,
	isPathAllowed,
	isWebhookMethod,
	parseChannelPath,
} from "./webhook-url.js";

describe("parseChannelPath", () => {
	it("parses the bare channel URL", () => {
		expect(parseChannelPath("/2324radf23r")).toEqual({
			channelId: "2324radf23r",
			forwardPath: "/",
		});
	});

	it("treats a trailing slash as the root path", () => {
		expect(parseChannelPath("/2324radf23r/")).toEqual({
			channelId: "2324radf23r",
			forwardPath: "/",
		});
	});

	it("forwards everything after the id", () => {
		expect(parseChannelPath("/2324radf23r/stripe/webhook")).toEqual({
			channelId: "2324radf23r",
			forwardPath: "/stripe/webhook",
		});
	});

	it("keeps /hook/<id> as an alias", () => {
		expect(parseChannelPath("/hook/2324radf23r")).toEqual({
			channelId: "2324radf23r",
			forwardPath: "/",
		});
	});

	it("never treats executor control endpoints as webhook URLs", () => {
		expect(parseChannelPath("/hook/2324radf23r/claim")).toBeNull();
		expect(parseChannelPath("/hook/2324radf23r/response")).toBeNull();
	});

	it("rejects reserved first segments", () => {
		for (const p of ["/api", "/api/channels", "/auth/sign-in", "/health", "/hook"]) {
			expect(parseChannelPath(p)).toBeNull();
		}
	});

	it("rejects ids that are not lowercase alphanumeric", () => {
		for (const p of ["/", "/ABC123", "/ch_abc", "/favicon.ico", `/${"a".repeat(25)}`]) {
			expect(parseChannelPath(p)).toBeNull();
		}
	});
});

describe("buildWebhookUrl", () => {
	it("is origin + id, with no path prefix", () => {
		expect(
			buildWebhookUrl("2324radf23r", new URL("https://relay.bridgehook.dev/api/channels")),
		).toBe("https://relay.bridgehook.dev/2324radf23r");
		expect(buildWebhookUrl("abc", new URL("http://localhost:8787/api/me/channels"))).toBe(
			"http://localhost:8787/abc",
		);
	});
});

describe("isWebhookMethod", () => {
	it("accepts POST, PUT, PATCH and DELETE only", () => {
		for (const m of ["POST", "put", "PATCH", "DELETE"]) expect(isWebhookMethod(m)).toBe(true);
		for (const m of ["GET", "HEAD", "OPTIONS"]) expect(isWebhookMethod(m)).toBe(false);
	});
});

describe("isPathAllowed", () => {
	it("allows everything with no list or a / entry", () => {
		expect(isPathAllowed("/stripe/webhook", [])).toBe(true);
		expect(isPathAllowed("/stripe/webhook", ["/"])).toBe(true);
		expect(isPathAllowed("/", ["/"])).toBe(true);
	});

	it("matches an entry and anything below it, not siblings", () => {
		expect(isPathAllowed("/webhook", ["/webhook"])).toBe(true);
		expect(isPathAllowed("/webhook/stripe", ["/webhook"])).toBe(true);
		expect(isPathAllowed("/webhooks", ["/webhook"])).toBe(false);
		expect(isPathAllowed("/other", ["/webhook", "/github"])).toBe(false);
	});

	it("ignores trailing slashes on entries", () => {
		expect(isPathAllowed("/webhook/stripe", ["/webhook/"])).toBe(true);
		expect(isPathAllowed("/webhook", ["/webhook/"])).toBe(true);
	});
});
