import { describe, expect, it } from "vitest";
import {
	buildWebhookUrl,
	classifyHost,
	isPathAllowed,
	isWebhookMethod,
	parseChannelPath,
	stripOwnCookies,
} from "./webhook-url.js";

describe("classifyHost", () => {
	const D = "bridgehook.dev";

	it("recognises a channel host, ignoring case, port and trailing dot", () => {
		const want = { kind: "channel", channelId: "34565sdfq344s" };
		expect(classifyHost("34565sdfq344s.bridgehook.dev", D)).toEqual(want);
		expect(classifyHost("34565SDFQ344S.BridgeHook.dev:443", D)).toEqual(want);
		expect(classifyHost("34565sdfq344s.bridgehook.dev.", D)).toEqual(want);
	});

	it("never treats first-party or mail hosts as channels", () => {
		for (const l of ["relay", "app", "docs", "www", "api", "cf-bounce"]) {
			expect(classifyHost(`${l}.bridgehook.dev`, D)).toEqual({ kind: "reserved", label: l });
		}
	});

	it("marks in-zone hosts that are not channels as zone", () => {
		for (const h of [
			"a.b.bridgehook.dev",
			"bad_label.bridgehook.dev",
			"foo-bar.bridgehook.dev",
			`${"a".repeat(25)}.bridgehook.dev`,
		]) {
			expect(classifyHost(h, D)).toEqual({ kind: "zone" });
		}
	});

	it("ignores the apex, other domains and lookalikes", () => {
		for (const h of [
			"bridgehook.dev",
			"abc.example.com",
			"abc.evilbridgehook.dev",
			"abc.bridgehook.dev.evil.com",
		]) {
			expect(classifyHost(h, D)).toEqual({ kind: "other" });
		}
	});

	it("is off without TUNNEL_DOMAIN or a Host header", () => {
		expect(classifyHost("abc.bridgehook.dev", undefined)).toEqual({ kind: "other" });
		expect(classifyHost(null, D)).toEqual({ kind: "other" });
	});
});

describe("buildWebhookUrl with TUNNEL_DOMAIN", () => {
	it("gives the channel host in production, whatever host served the API call", () => {
		expect(
			buildWebhookUrl(
				"34565sdfq344s",
				new URL("https://relay.bridgehook.dev/api/channels"),
				"bridgehook.dev",
			),
		).toBe("https://34565sdfq344s.bridgehook.dev");
		expect(
			buildWebhookUrl("abc", new URL("https://x.workers.dev/api/me/channels"), "BridgeHook.dev"),
		).toBe("https://abc.bridgehook.dev");
	});

	it("falls back to the path form over plain http (local dev)", () => {
		expect(
			buildWebhookUrl("abc", new URL("http://localhost:8787/api/channels"), "bridgehook.dev"),
		).toBe("http://localhost:8787/abc");
	});
});

describe("stripOwnCookies", () => {
	it("removes BridgeHook session cookies and keeps the rest", () => {
		expect(
			stripOwnCookies(
				"__Secure-better-auth.session_token=abc; theme=dark; better-auth.session_data=x; a=b",
			),
		).toBe("theme=dark; a=b");
	});

	it("returns null when only BridgeHook cookies were present", () => {
		expect(stripOwnCookies("__Secure-better-auth.session_token=abc")).toBeNull();
	});

	it("leaves unrelated cookies untouched", () => {
		expect(stripOwnCookies("stripe_mid=1; session=xyz")).toBe("stripe_mid=1; session=xyz");
	});
});

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
