import { CHANNEL_EXPIRY_HOURS, MAX_BODY_SIZE_BYTES, MAX_BUFFERED_EVENTS } from "@bridgehook/shared";
import { events, channels } from "@bridgehook/shared/db/schema";
import { neon } from "@neondatabase/serverless";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

export { ChannelDO } from "./channel-do.js";

export interface Env {
	DATABASE_URL: string;
	CHANNEL: DurableObjectNamespace;
}

/** CORS headers for all responses */
function corsHeaders(origin?: string): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": origin || "*",
		"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Max-Age": "86400",
	};
}

function json(data: unknown, status = 200, origin?: string): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			...corsHeaders(origin),
		},
	});
}

/** Get the Durable Object stub for a channel */
function getChannelDO(env: Env, channelId: string) {
	const id = env.CHANNEL.idFromName(channelId);
	return env.CHANNEL.get(id);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const origin = request.headers.get("Origin") || undefined;

		// CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders(origin),
			});
		}

		const sql = neon(env.DATABASE_URL);
		const db = drizzle(sql);

		try {
			// ── Health ──
			if (path === "/health") {
				return json({ status: "ok" }, 200, origin);
			}

			// ── Create channel ──
			if (path === "/api/channels" && request.method === "POST") {
				const body = (await request.json()) as {
					secretHash: string;
					port: number;
					allowedPaths?: string[];
				};

				const channelId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
				const expiresAt = new Date(Date.now() + CHANNEL_EXPIRY_HOURS * 60 * 60 * 1000);

				const [channel] = await db
					.insert(channels)
					.values({
						id: channelId,
						secretHash: body.secretHash,
						port: body.port,
						allowedPaths: JSON.stringify(body.allowedPaths || []),
						expiresAt,
					})
					.returning();

				return json(
					{
						channelId: channel.id,
						port: channel.port,
						expiresAt: channel.expiresAt.toISOString(),
						webhookUrl: `${url.origin}/hook/${channel.id}`,
					},
					201,
					origin,
				);
			}

			// ── Get channel info ──
			if (path.match(/^\/api\/channels\/[a-z0-9]+$/) && request.method === "GET") {
				const channelId = path.split("/").pop()!;
				const [channel] = await db
					.select()
					.from(channels)
					.where(eq(channels.id, channelId))
					.limit(1);

				if (!channel) return json({ error: "Channel not found" }, 404, origin);

				return json(
					{
						id: channel.id,
						port: channel.port,
						allowedPaths: JSON.parse(channel.allowedPaths),
						createdAt: channel.createdAt.toISOString(),
						expiresAt: channel.expiresAt.toISOString(),
						webhookUrl: `${url.origin}/hook/${channel.id}`,
					},
					200,
					origin,
				);
			}

			// ── Delete channel ──
			if (path.match(/^\/api\/channels\/[a-z0-9]+$/) && request.method === "DELETE") {
				const channelId = path.split("/").pop()!;
				await db.delete(channels).where(eq(channels.id, channelId));
				return json({ deleted: true }, 200, origin);
			}

			// ── List events for channel (polling endpoint) ──
			if (path.match(/^\/api\/channels\/[a-z0-9]+\/events$/) && request.method === "GET") {
				const channelId = path.split("/")[3];
				const limit = Math.min(Number(url.searchParams.get("limit") || "50"), MAX_BUFFERED_EVENTS);

				const rows = await db
					.select()
					.from(events)
					.where(eq(events.channelId, channelId))
					.orderBy(desc(events.receivedAt))
					.limit(limit);

				return json(rows, 200, origin);
			}

			// ── SSE stream for channel → routed to Durable Object ──
			if (path.match(/^\/hook\/[a-z0-9]+\/events$/) && request.method === "GET") {
				const channelId = path.split("/")[2];

				// Verify channel exists in Neon
				const [channel] = await db
					.select()
					.from(channels)
					.where(eq(channels.id, channelId))
					.limit(1);

				if (!channel) return json({ error: "Channel not found" }, 404, origin);

				// Delegate to Durable Object — it holds the SSE connections
				const stub = getChannelDO(env, channelId);
				return stub.fetch(request);
			}

			// ── Receive webhook (from external sender like Stripe) ──
			if (path.match(/^\/hook\/[a-z0-9]+$/) && ["POST", "PUT", "PATCH"].includes(request.method)) {
				const channelId = path.split("/")[2];

				// Check body size
				const contentLength = Number(request.headers.get("content-length") || "0");
				if (contentLength > MAX_BODY_SIZE_BYTES) {
					return json({ error: "Body too large" }, 413, origin);
				}

				// Verify channel exists
				const [channel] = await db
					.select()
					.from(channels)
					.where(eq(channels.id, channelId))
					.limit(1);

				if (!channel) return json({ error: "Channel not found" }, 404, origin);

				const eventId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
				const headers: Record<string, string> = {};
				request.headers.forEach((value, key) => {
					headers[key] = value;
				});
				const body = await request.text();

				// Store event in Neon DB
				const [evt] = await db
					.insert(events)
					.values({
						id: eventId,
						channelId,
						method: request.method,
						path: url.pathname,
						requestHeaders: JSON.stringify(headers),
						requestBody: body || null,
					})
					.returning();

				// Push to SSE listeners via Durable Object
				const ssePayload = JSON.stringify({
					type: "webhook",
					id: evt.id,
					channelId,
					method: evt.method,
					path: evt.path,
					headers,
					body,
					receivedAt: evt.receivedAt.toISOString(),
				});

				const stub = getChannelDO(env, channelId);
				stub
					.fetch(
						new Request("https://do/notify", {
							method: "POST",
							body: ssePayload,
						}),
					)
					.catch(() => {
						// DO notification is best-effort — polling is the fallback
					});

				return json({ received: true, eventId: evt.id, channelId }, 202, origin);
			}

			// ── Receive response from browser/extension/desktop ──
			if (path.match(/^\/hook\/[a-z0-9]+\/response$/) && request.method === "POST") {
				const channelId = path.split("/")[2];
				const {
					eventId,
					status,
					headers: respHeaders,
					body: respBody,
					latencyMs,
				} = (await request.json()) as {
					eventId: string;
					status: number;
					headers: Record<string, string>;
					body: string;
					latencyMs: number;
				};

				// Update event in Neon DB
				await db
					.update(events)
					.set({
						responseStatus: status,
						responseHeaders: JSON.stringify(respHeaders || {}),
						responseBody: respBody,
						latencyMs,
					})
					.where(eq(events.id, eventId));

				// Notify SSE listeners about the response via DO
				const responsePayload = JSON.stringify({
					type: "response",
					eventId,
					status,
					latencyMs,
				});

				const stub = getChannelDO(env, channelId);
				stub
					.fetch(
						new Request("https://do/notify", {
							method: "POST",
							body: responsePayload,
						}),
					)
					.catch(() => {});

				return json({ ok: true }, 200, origin);
			}

			return json({ error: "Not Found" }, 404, origin);
		} catch (err) {
			console.error("Relay error:", err);
			return json({ error: "Internal Server Error" }, 500, origin);
		}
	},
} satisfies ExportedHandler<Env>;
