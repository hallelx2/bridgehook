/**
 * BridgeHook MCP server: `https://relay.bridgehook.dev/mcp`.
 *
 * Lets a coding agent (Claude Code, Cursor, Codex, any MCP client) run the
 * whole webhook loop against the user's real local server, with nothing to
 * install: get a permanent webhook URL for a port, fire a realistic signed
 * provider webhook at it, wait for it to arrive, read what the local handler
 * answered, and replay it after fixing the code.
 *
 * Transport: MCP Streamable HTTP, stateless (a fresh server per request,
 * JSON responses), so it runs in the relay Worker with no session storage.
 * Auth: `Authorization: Bearer dvc_…`, an agent token minted from the
 * dashboard (or any device token); the browser session also works.
 */
import { events, channels } from "@bridgehook/shared/db/schema";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { and, asc, desc, eq, gt, like, sql } from "drizzle-orm";
import { z } from "zod";
import { checkChannelCreate, loadUserAccess } from "./access.js";
import type { DB } from "./db.js";
import {
	type ReplayNotifier,
	loadOwnedEvent,
	queueReplay,
	serializeEventDetail,
} from "./event-store.js";
import { clampSyncTimeout } from "./sync.js";
import { TEST_PROVIDERS, buildTestEvent } from "./test-events.js";
import { buildWebhookUrl } from "./webhook-url.js";

export interface McpContext {
	db: DB;
	userId: string;
	deviceId: string | null;
	/** URL of the /mcp request; its origin builds path-form webhook URLs. */
	requestUrl: URL;
	tunnelDomain?: string;
	notifier: ReplayNotifier;
	/**
	 * Deliver a request to a channel exactly as if the provider had sent it
	 * (full intake: allow-list, quota, storage, sync wait).
	 */
	deliver(channelId: string, forwardPath: string, request: Request): Promise<Response>;
}

const INSTRUCTIONS = `BridgeHook delivers real webhooks to the user's local server through a permanent URL per port, even while their machine is off (queued, delivered in order). Use it to build and debug webhook handlers end to end.

Typical loop:
1. create_webhook_url(port) for the port the user's app listens on. Register that URL with the provider, or skip that and use send_test_event.
2. send_test_event(channel_id, provider, signing_secret?) fires a realistic, optionally signed payload (stripe, github, openai, elevenlabs, vapi, generic), or wait_for_webhook catches a real one.
3. get_event(event_id) shows the request AND what the local handler answered (status, headers, body, latency, error).
4. Fix the handler, then replay_event(event_id) and compare.

Forwarding to localhost is done by the user's BridgeHook Chrome extension. If an event stays unanswered, ask the user to add the port in the BridgeHook extension (it reuses the same URL). For tool-call webhooks whose reply matters (Vapi, ElevenLabs server tools) or GET verification challenges, set_response_mode(channel_id, "sync").`;

const BODY_LIMIT = 16_000;

function text(v: unknown) {
	return {
		content: [
			{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) },
		],
	};
}
function fail(message: string) {
	return { content: [{ type: "text" as const, text: message }], isError: true };
}
function clip(s: string | null): string | null {
	if (s == null || s.length <= BODY_LIMIT) return s;
	return `${s.slice(0, BODY_LIMIT)}\n… [truncated: ${s.length} chars total; use the dashboard for the full body]`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ownedChannel(db: DB, userId: string, channelId: string) {
	const [ch] = await db
		.select()
		.from(channels)
		.where(and(eq(channels.id, channelId), eq(channels.userId, userId)))
		.limit(1);
	return ch ?? null;
}

async function newPublicKeyHex(): Promise<string> {
	// The relay keeps only the public key. The extension
	// adopts the channel later by rotating in its own key.
	const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
	return Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Poll an event row until an executor has answered it, or time runs out. */
async function waitForAnswer(db: DB, userId: string, eventId: string, deadline: number) {
	for (;;) {
		const evt = await loadOwnedEvent(db, userId, eventId);
		if (!evt) return null;
		if (evt.responseStatus !== null || evt.error !== null || Date.now() >= deadline) return evt;
		await sleep(1000);
	}
}

function summarize(evt: ReturnType<typeof serializeEventDetail>) {
	return {
		...evt,
		requestBody: clip(evt.requestBody),
		responseBody: clip(evt.responseBody),
		status:
			evt.responseStatus === null && evt.error === null
				? "pending: no executor has answered yet"
				: evt.responseStatus === 0
					? "failed: local server unreachable or kept failing"
					: `answered ${evt.responseStatus}`,
	};
}

export function buildMcpServer(ctx: McpContext): McpServer {
	const server = new McpServer(
		{ name: "bridgehook", version: "1.0.0" },
		{ instructions: INSTRUCTIONS },
	);
	const urlFor = (id: string) => buildWebhookUrl(id, ctx.requestUrl, ctx.tunnelDomain);

	server.registerTool(
		"list_webhook_urls",
		{
			title: "List webhook URLs",
			description:
				"The user's BridgeHook channels: webhook URL, local port, reply mode, last event.",
			inputSchema: {},
			annotations: { readOnlyHint: true },
		},
		async () => {
			const rows = await ctx.db
				.select({
					id: channels.id,
					port: channels.port,
					label: channels.label,
					responseMode: channels.responseMode,
					syncTimeoutMs: channels.syncTimeoutMs,
					lastEventAt: sql<
						number | null
					>`(select max(${events.receivedAt}) from ${events} where ${events.channelId} = ${channels.id})`,
				})
				.from(channels)
				.where(eq(channels.userId, ctx.userId))
				.orderBy(desc(channels.createdAt));
			return text({
				channels: rows.map((r) => ({
					channel_id: r.id,
					webhook_url: urlFor(r.id),
					local_port: r.port,
					label: r.label,
					reply_mode: r.responseMode,
					sync_timeout_seconds: r.syncTimeoutMs / 1000,
					last_event_at: r.lastEventAt ? new Date(r.lastEventAt).toISOString() : null,
				})),
			});
		},
	);

	server.registerTool(
		"create_webhook_url",
		{
			title: "Get a webhook URL for a local port",
			description:
				"Returns the permanent webhook URL for a local port, creating it if needed (the same port always gets the same URL). Optionally sets the reply mode.",
			inputSchema: {
				port: z.number().int().min(1).max(65535).describe("Port the local app listens on"),
				label: z.string().max(64).optional().describe("Name shown in the dashboard"),
				reply_mode: z
					.enum(["async", "sync"])
					.optional()
					.describe("async: sender gets 202 at once. sync: sender gets the local server's reply"),
				sync_timeout_seconds: z.number().min(1).max(100).optional(),
			},
		},
		async ({ port, label, reply_mode, sync_timeout_seconds }) => {
			const patch: { responseMode?: "async" | "sync"; syncTimeoutMs?: number; label?: string } = {};
			if (reply_mode) patch.responseMode = reply_mode;
			if (sync_timeout_seconds !== undefined) {
				patch.syncTimeoutMs = clampSyncTimeout(sync_timeout_seconds * 1000) ?? undefined;
			}
			const [existing] = await ctx.db
				.select()
				.from(channels)
				.where(and(eq(channels.userId, ctx.userId), eq(channels.port, port)))
				.orderBy(asc(channels.createdAt))
				.limit(1);
			if (existing) {
				if (Object.keys(patch).length > 0) {
					await ctx.db.update(channels).set(patch).where(eq(channels.id, existing.id));
				}
				return text({
					channel_id: existing.id,
					webhook_url: urlFor(existing.id),
					local_port: port,
					reply_mode: patch.responseMode ?? existing.responseMode,
					created: false,
				});
			}
			const access = await loadUserAccess(ctx.db, ctx.userId);
			if (!access) return fail("Account not found");
			const gate = await checkChannelCreate(ctx.db, access);
			if (!gate.ok) return fail(gate.error);
			const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
			await ctx.db.insert(channels).values({
				id,
				publicKey: await newPublicKeyHex(),
				port,
				allowedPaths: "[]",
				userId: ctx.userId,
				deviceId: ctx.deviceId,
				label: label ?? null,
				expiresAt: null,
				responseMode: patch.responseMode ?? "async",
				syncTimeoutMs: patch.syncTimeoutMs ?? 25_000,
			});
			return text({
				channel_id: id,
				webhook_url: urlFor(id),
				local_port: port,
				reply_mode: patch.responseMode ?? "async",
				created: true,
				next_step: `Webhooks to this URL are queued (nothing is lost). To forward them to localhost:${port}, the user adds port ${port} in the BridgeHook Chrome extension, which adopts this same URL.`,
			});
		},
	);

	server.registerTool(
		"set_response_mode",
		{
			title: "Set reply mode",
			description:
				"sync: the webhook sender gets the local server's actual reply (for Vapi/ElevenLabs tool calls and GET verification challenges). async: the sender gets 202 at once.",
			inputSchema: {
				channel_id: z.string(),
				reply_mode: z.enum(["async", "sync"]),
				sync_timeout_seconds: z.number().min(1).max(100).optional(),
			},
		},
		async ({ channel_id, reply_mode, sync_timeout_seconds }) => {
			const ch = await ownedChannel(ctx.db, ctx.userId, channel_id);
			if (!ch) return fail("Channel not found");
			const syncTimeoutMs =
				sync_timeout_seconds === undefined
					? ch.syncTimeoutMs
					: (clampSyncTimeout(sync_timeout_seconds * 1000) ?? ch.syncTimeoutMs);
			await ctx.db
				.update(channels)
				.set({ responseMode: reply_mode, syncTimeoutMs })
				.where(eq(channels.id, ch.id));
			return text({ channel_id: ch.id, reply_mode, sync_timeout_seconds: syncTimeoutMs / 1000 });
		},
	);

	server.registerTool(
		"send_test_event",
		{
			title: "Send a test webhook",
			description:
				"Fire a realistic provider webhook at a channel, signed like the provider when signing_secret is given (Stripe, GitHub, OpenAI Standard Webhooks, ElevenLabs), then wait for the local server's answer.",
			inputSchema: {
				channel_id: z.string(),
				provider: z.enum(TEST_PROVIDERS),
				event_type: z
					.string()
					.max(80)
					.optional()
					.describe("e.g. checkout.session.completed, push, batch.completed"),
				path: z
					.string()
					.max(256)
					.optional()
					.describe("Path on the local server, e.g. /api/webhooks/stripe"),
				signing_secret: z
					.string()
					.max(256)
					.optional()
					.describe("The endpoint secret the handler verifies with"),
				wait_seconds: z
					.number()
					.min(0)
					.max(55)
					.optional()
					.describe("How long to wait for the answer (default 20)"),
			},
		},
		async ({ channel_id, provider, event_type, path, signing_secret, wait_seconds }) => {
			const ch = await ownedChannel(ctx.db, ctx.userId, channel_id);
			if (!ch) return fail("Channel not found");
			let testEvent: Awaited<ReturnType<typeof buildTestEvent>>;
			try {
				testEvent = await buildTestEvent(provider, { type: event_type, secret: signing_secret });
			} catch (err) {
				return fail(err instanceof Error ? err.message : String(err));
			}
			const p = path ? (path.startsWith("/") ? path : `/${path}`) : "/";
			const target = ctx.tunnelDomain
				? `https://${ch.id}.${ctx.tunnelDomain}${p}`
				: `${ctx.requestUrl.origin}/${ch.id}${p === "/" ? "" : p}`;
			const req = new Request(target, {
				method: testEvent.method,
				headers: { ...testEvent.headers, host: new URL(target).host },
				body: testEvent.body,
			});
			const waitMs = (wait_seconds ?? 20) * 1000;
			if (ch.responseMode === "sync") {
				// The sender is held up to the channel's sync timeout; the agent
				// waits at most wait_seconds and can look the event up afterwards.
				const delivered = ctx.deliver(ch.id, p, req);
				const raced = await Promise.race([delivered, sleep(waitMs).then(() => null)]);
				if (!raced) {
					return text({
						sent: testEvent.description,
						signed: testEvent.signed,
						reply_mode: "sync",
						still_waiting: `The local server had not answered after ${waitMs / 1000}s. Check list_events / get_event for the outcome.`,
					});
				}
				const body = await raced.text();
				return text({
					sent: testEvent.description,
					signed: testEvent.signed,
					reply_mode: "sync",
					reply_returned_to_sender: {
						status: raced.status,
						event_id: raced.headers.get("x-bridgehook-event-id"),
						content_type: raced.headers.get("content-type"),
						body: clip(body),
					},
				});
			}
			const res = await ctx.deliver(ch.id, p, req);
			const resText = await res.text();
			let eventId: string | null = null;
			try {
				eventId = (JSON.parse(resText) as { eventId?: string }).eventId ?? null;
			} catch {}
			if (res.status !== 202 || !eventId) {
				return fail(`Relay refused the test webhook: ${res.status} ${resText.slice(0, 300)}`);
			}
			const evt = await waitForAnswer(ctx.db, ctx.userId, eventId, Date.now() + waitMs);
			return text({
				sent: testEvent.description,
				signed: testEvent.signed,
				event: evt ? summarize(serializeEventDetail(evt)) : { event_id: eventId },
			});
		},
	);

	server.registerTool(
		"wait_for_webhook",
		{
			title: "Wait for a webhook",
			description:
				"Block until a webhook matching the filters arrives (default: any new webhook on any channel), optionally until the local server has answered it.",
			inputSchema: {
				channel_id: z.string().optional(),
				method: z.string().max(10).optional(),
				path_contains: z.string().max(200).optional(),
				since: z.string().optional().describe("ISO time; default: now"),
				timeout_seconds: z.number().min(1).max(55).optional().describe("default 30"),
				wait_for_answer: z
					.boolean()
					.optional()
					.describe("Also wait until the local server answered"),
			},
			annotations: { readOnlyHint: true },
		},
		async ({ channel_id, method, path_contains, since, timeout_seconds, wait_for_answer }) => {
			const start = since ? new Date(since) : new Date(Date.now() - 1000);
			if (Number.isNaN(start.getTime())) return fail("since must be an ISO date-time");
			const deadline = Date.now() + (timeout_seconds ?? 30) * 1000;
			const conds = [eq(channels.userId, ctx.userId), gt(events.receivedAt, start)];
			if (channel_id) conds.push(eq(events.channelId, channel_id));
			if (method) conds.push(eq(events.method, method.toUpperCase()));
			if (path_contains) {
				const pat = `%${path_contains.replace(/[%_\\]/g, (s) => `\\${s}`)}%`;
				conds.push(sql`${events.path} LIKE ${pat} ESCAPE '\\'`);
			}
			for (;;) {
				const [hit] = await ctx.db
					.select({ id: events.id })
					.from(events)
					.innerJoin(channels, eq(events.channelId, channels.id))
					.where(and(...conds))
					.orderBy(asc(events.receivedAt))
					.limit(1);
				if (hit) {
					const evt = wait_for_answer
						? await waitForAnswer(ctx.db, ctx.userId, hit.id, deadline)
						: await loadOwnedEvent(ctx.db, ctx.userId, hit.id);
					return text(evt ? summarize(serializeEventDetail(evt)) : { event_id: hit.id });
				}
				if (Date.now() >= deadline) {
					return text({
						received: false,
						message: "No matching webhook arrived before the timeout.",
					});
				}
				await sleep(1000);
			}
		},
	);

	server.registerTool(
		"get_event",
		{
			title: "Get a webhook event",
			description:
				"The full request and what the local server answered (status, headers, body, latency, error).",
			inputSchema: { event_id: z.string() },
			annotations: { readOnlyHint: true },
		},
		async ({ event_id }) => {
			const evt = await loadOwnedEvent(ctx.db, ctx.userId, event_id);
			if (!evt) return fail("Event not found");
			return text(summarize(serializeEventDetail(evt)));
		},
	);

	server.registerTool(
		"list_events",
		{
			title: "List recent webhook events",
			description: "Most recent events, newest first.",
			inputSchema: {
				channel_id: z.string().optional(),
				path_contains: z.string().max(200).optional(),
				limit: z.number().int().min(1).max(50).optional(),
			},
			annotations: { readOnlyHint: true },
		},
		async ({ channel_id, path_contains, limit }) => {
			const conds = [eq(channels.userId, ctx.userId)];
			if (channel_id) conds.push(eq(events.channelId, channel_id));
			if (path_contains) {
				conds.push(like(events.path, `%${path_contains.replace(/[%_\\]/g, "")}%`));
			}
			const rows = await ctx.db
				.select({
					id: events.id,
					channelId: events.channelId,
					method: events.method,
					path: events.path,
					responseStatus: events.responseStatus,
					latencyMs: events.latencyMs,
					error: events.error,
					kind: events.kind,
					receivedAt: events.receivedAt,
				})
				.from(events)
				.innerJoin(channels, eq(events.channelId, channels.id))
				.where(and(...conds))
				.orderBy(desc(events.receivedAt))
				.limit(limit ?? 20);
			return text({
				events: rows.map((r) => ({
					event_id: r.id,
					channel_id: r.channelId,
					method: r.method,
					path: r.path,
					response_status: r.responseStatus,
					latency_ms: r.latencyMs,
					error: r.error,
					kind: r.kind,
					received_at: r.receivedAt.toISOString(),
				})),
			});
		},
	);

	server.registerTool(
		"replay_event",
		{
			title: "Replay a webhook",
			description:
				"Send an earlier webhook to the local server again (optionally with a new body or headers) and wait for the new answer. Use after fixing the handler.",
			inputSchema: {
				event_id: z.string(),
				body: z.string().optional(),
				headers: z.record(z.string(), z.string()).optional(),
				wait_seconds: z.number().min(0).max(55).optional().describe("default 20"),
			},
		},
		async ({ event_id, body, headers, wait_seconds }) => {
			const source = await loadOwnedEvent(ctx.db, ctx.userId, event_id);
			if (!source) return fail("Event not found");
			const replay = await queueReplay(ctx.db, ctx.notifier, ctx.userId, source, { body, headers });
			if (!replay.ok) return fail(replay.error);
			const evt = await waitForAnswer(
				ctx.db,
				ctx.userId,
				replay.replayId,
				Date.now() + (wait_seconds ?? 20) * 1000,
			);
			return text(evt ? summarize(serializeEventDetail(evt)) : { replay_id: replay.replayId });
		},
	);

	return server;
}

/** Handle one MCP request (stateless Streamable HTTP, JSON responses). */
export async function handleMcpRequest(request: Request, ctx: McpContext): Promise<Response> {
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	const server = buildMcpServer(ctx);
	await server.connect(transport);
	return transport.handleRequest(request);
}
