import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { channels, events } from "@bridgehook/shared/db/schema";
import { eq, desc } from "drizzle-orm";
import {
	MAX_BUFFERED_EVENTS,
	MAX_BODY_SIZE_BYTES,
	CHANNEL_EXPIRY_HOURS,
} from "@bridgehook/shared";

export interface Env {
	DATABASE_URL: string;
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

/** In-memory SSE connections per channel (not persisted — ephemeral) */
const sseConnections = new Map<string, Set<WritableStreamDefaultWriter>>();

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
				const expiresAt = new Date(
					Date.now() + CHANNEL_EXPIRY_HOURS * 60 * 60 * 1000,
				);

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

			// ── List events for channel ──
			if (path.match(/^\/api\/channels\/[a-z0-9]+\/events$/) && request.method === "GET") {
				const channelId = path.split("/")[3];
				const limit = Math.min(
					Number(url.searchParams.get("limit") || "50"),
					MAX_BUFFERED_EVENTS,
				);

				const rows = await db
					.select()
					.from(events)
					.where(eq(events.channelId, channelId))
					.orderBy(desc(events.receivedAt))
					.limit(limit);

				return json(rows, 200, origin);
			}

			// ── SSE stream for channel ──
			if (path.match(/^\/hook\/[a-z0-9]+\/events$/) && request.method === "GET") {
				const channelId = path.split("/")[2];

				// Verify channel exists
				const [channel] = await db
					.select()
					.from(channels)
					.where(eq(channels.id, channelId))
					.limit(1);

				if (!channel) return json({ error: "Channel not found" }, 404, origin);

				const { readable, writable } = new TransformStream();
				const writer = writable.getWriter();
				const encoder = new TextEncoder();

				// Track connection
				if (!sseConnections.has(channelId)) {
					sseConnections.set(channelId, new Set());
				}
				sseConnections.get(channelId)!.add(writer);

				// Send connected event
				writer.write(
					encoder.encode(
						`data: ${JSON.stringify({ type: "connected", channelId })}\n\n`,
					),
				);

				// Cleanup on disconnect
				readable.pipeTo(new WritableStream()).catch(() => {
					sseConnections.get(channelId)?.delete(writer);
					if (sseConnections.get(channelId)?.size === 0) {
						sseConnections.delete(channelId);
					}
				});

				return new Response(readable, {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						Connection: "keep-alive",
						...corsHeaders(origin),
					},
				});
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

				// Store event in DB
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

				// Push to SSE connections
				const connections = sseConnections.get(channelId);
				if (connections && connections.size > 0) {
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
					const encoder = new TextEncoder();
					const message = encoder.encode(`data: ${ssePayload}\n\n`);

					for (const writer of connections) {
						writer.write(message).catch(() => {
							connections.delete(writer);
						});
					}
				}

				return json(
					{ received: true, eventId: evt.id, channelId },
					202,
					origin,
				);
			}

			// ── Receive response from browser ──
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

				// Update event with response data
				await db
					.update(events)
					.set({
						responseStatus: status,
						responseHeaders: JSON.stringify(respHeaders || {}),
						responseBody: respBody,
						latencyMs,
					})
					.where(eq(events.id, eventId));

				// Push response update to SSE listeners
				const connections = sseConnections.get(channelId);
				if (connections && connections.size > 0) {
					const payload = JSON.stringify({
						type: "response",
						eventId,
						status,
						latencyMs,
					});
					const encoder = new TextEncoder();
					const message = encoder.encode(`data: ${payload}\n\n`);
					for (const writer of connections) {
						writer.write(message).catch(() => connections.delete(writer));
					}
				}

				return json({ ok: true }, 200, origin);
			}

			return json({ error: "Not Found" }, 404, origin);
		} catch (err) {
			console.error("Relay error:", err);
			return json(
				{ error: "Internal Server Error" },
				500,
				origin,
			);
		}
	},
} satisfies ExportedHandler<Env>;
