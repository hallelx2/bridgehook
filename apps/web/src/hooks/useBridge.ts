import { useCallback, useEffect, useRef, useState } from "react";
import type { SSEEvent, SSEWebhookEvent, WebhookEventData } from "../lib/relay";
import {
	connectSSE,
	createChannel,
	forwardToLocalhost,
	getEvents,
	sendResponse,
} from "../lib/relay";

export interface LiveEvent {
	id: string;
	method: string;
	path: string;
	requestHeaders: Record<string, string>;
	requestBody: string | null;
	responseStatus: number | null;
	responseBody: string | null;
	latencyMs: number | null;
	error: string | null;
	receivedAt: string;
}

interface BridgeState {
	status: "idle" | "connecting" | "connected" | "error";
	channelId: string | null;
	webhookUrl: string | null;
	port: number;
	events: LiveEvent[];
	error: string | null;
}

export function useBridge() {
	const [state, setState] = useState<BridgeState>({
		status: "idle",
		channelId: null,
		webhookUrl: null,
		port: 3000,
		events: [],
		error: null,
	});

	const disconnectRef = useRef<(() => void) | null>(null);

	const handleSSEEvent = useCallback(
		(sseEvent: SSEEvent) => {
			if (sseEvent.type === "connected") {
				setState((s) => ({ ...s, status: "connected" }));
			}

			if (sseEvent.type === "webhook") {
				const webhookEvent = sseEvent as SSEWebhookEvent;
				// Add event to list immediately
				const liveEvent: LiveEvent = {
					id: webhookEvent.id,
					method: webhookEvent.method,
					path: webhookEvent.path,
					requestHeaders: webhookEvent.headers,
					requestBody: webhookEvent.body,
					responseStatus: null,
					responseBody: null,
					latencyMs: null,
					error: null,
					receivedAt: webhookEvent.receivedAt,
				};

				setState((s) => ({
					...s,
					events: [liveEvent, ...s.events].slice(0, 100),
				}));

				// Forward to localhost (client-side bridge!)
				forwardToLocalhost(webhookEvent, state.port)
					.then((response) => {
						// Update event with response
						setState((s) => ({
							...s,
							events: s.events.map((e) =>
								e.id === webhookEvent.id
									? {
											...e,
											responseStatus: response.status,
											responseBody: response.body,
											latencyMs: response.latencyMs,
										}
									: e,
							),
						}));

						// Send response back to relay (server stores in Neon)
						if (state.channelId) {
							sendResponse(state.channelId, webhookEvent.id, response);
						}
					})
					.catch((err) => {
						setState((s) => ({
							...s,
							events: s.events.map((e) =>
								e.id === webhookEvent.id ? { ...e, error: (err as Error).message } : e,
							),
						}));
					});
			}

			if (sseEvent.type === "response") {
				// Update from server-side confirmation
				setState((s) => ({
					...s,
					events: s.events.map((e) =>
						e.id === sseEvent.eventId
							? {
									...e,
									responseStatus: sseEvent.status,
									latencyMs: sseEvent.latencyMs,
								}
							: e,
					),
				}));
			}
		},
		[state.port, state.channelId],
	);

	/** Start a new bridge: create channel (server-side), connect SSE, start forwarding */
	const connect = useCallback(
		async (port: number, allowedPaths: string[]) => {
			try {
				setState((s) => ({ ...s, status: "connecting", port, error: null }));

				// Server creates channel + persists to Neon
				const channel = await createChannel(port, allowedPaths);

				setState((s) => ({
					...s,
					channelId: channel.channelId,
					webhookUrl: channel.webhookUrl,
				}));

				// Load existing events from DB
				const existingEvents = await getEvents(channel.channelId);
				const liveEvents: LiveEvent[] = existingEvents.map((e: WebhookEventData) => ({
					id: e.id,
					method: e.method,
					path: e.path,
					requestHeaders: JSON.parse(e.requestHeaders || "{}"),
					requestBody: e.requestBody,
					responseStatus: e.responseStatus,
					responseBody: e.responseBody,
					latencyMs: e.latencyMs,
					error: e.error,
					receivedAt: e.receivedAt,
				}));

				setState((s) => ({ ...s, events: liveEvents }));

				// Connect SSE (client-side real-time stream)
				const disconnect = connectSSE(channel.channelId, handleSSEEvent, () => {
					setState((s) => ({
						...s,
						status: "error",
						error: "SSE connection lost",
					}));
				});

				disconnectRef.current = disconnect;
			} catch (err) {
				setState((s) => ({
					...s,
					status: "error",
					error: (err as Error).message,
				}));
			}
		},
		[handleSSEEvent],
	);

	/** Disconnect the bridge */
	const disconnect = useCallback(() => {
		disconnectRef.current?.();
		disconnectRef.current = null;
		setState({
			status: "idle",
			channelId: null,
			webhookUrl: null,
			port: 3000,
			events: [],
			error: null,
		});
	}, []);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			disconnectRef.current?.();
		};
	}, []);

	return {
		...state,
		connect,
		disconnect,
	};
}
