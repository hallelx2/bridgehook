import { useCallback, useEffect, useRef, useState } from "react";
import type { WebhookEventData } from "../lib/relay";
import {
	createChannel,
	forwardToLocalhost,
	getEvents,
	pollEvents,
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

function toLiveEvent(e: WebhookEventData): LiveEvent {
	return {
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
	};
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

	const stopPollingRef = useRef<(() => void) | null>(null);
	const forwardedRef = useRef<Set<string>>(new Set());

	/**
	 * When polling detects new events, check for unforwarded ones
	 * and forward them to localhost (the bridge!).
	 */
	const handleNewEvents = useCallback(
		(events: WebhookEventData[]) => {
			if (events.length === 0) {
				// Initial "connected" signal
				setState((s) => ({ ...s, status: "connected" }));
				return;
			}

			// Update event list
			const liveEvents = events.map(toLiveEvent);
			setState((s) => ({ ...s, events: liveEvents }));

			// Find events that haven't been forwarded yet (no response)
			const unforwarded = events.filter(
				(e) => !e.responseStatus && !e.error && !forwardedRef.current.has(e.id),
			);

			// Forward each to localhost
			for (const evt of unforwarded) {
				forwardedRef.current.add(evt.id);

				forwardToLocalhost(evt, state.port)
					.then((response) => {
						// Update local state with response
						setState((s) => ({
							...s,
							events: s.events.map((e) =>
								e.id === evt.id
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
							sendResponse(state.channelId, evt.id, response);
						}
					})
					.catch((err) => {
						setState((s) => ({
							...s,
							events: s.events.map((e) =>
								e.id === evt.id ? { ...e, error: (err as Error).message } : e,
							),
						}));
					});
			}
		},
		[state.port, state.channelId],
	);

	/** Start a new bridge: create channel, start polling */
	const connect = useCallback(
		async (port: number, allowedPaths: string[]) => {
			try {
				setState((s) => ({ ...s, status: "connecting", port, error: null }));
				forwardedRef.current = new Set();

				// Server creates channel + persists to Neon
				const channel = await createChannel(port, allowedPaths);

				setState((s) => ({
					...s,
					channelId: channel.channelId,
					webhookUrl: channel.webhookUrl,
				}));

				// Load existing events from DB
				const existingEvents = await getEvents(channel.channelId);
				const liveEvents = existingEvents.map(toLiveEvent);
				// Mark existing events as already forwarded
				for (const e of existingEvents) {
					forwardedRef.current.add(e.id);
				}
				setState((s) => ({ ...s, events: liveEvents, status: "connected" }));

				// Start polling for new events (every 2 seconds)
				const stopPolling = pollEvents(
					channel.channelId,
					handleNewEvents,
					(err) => {
						console.error("Polling error:", err);
						// Don't set error state for transient polling failures
					},
					2000,
				);

				stopPollingRef.current = stopPolling;
			} catch (err) {
				setState((s) => ({
					...s,
					status: "error",
					error: (err as Error).message,
				}));
			}
		},
		[handleNewEvents],
	);

	/** Disconnect the bridge */
	const disconnect = useCallback(() => {
		stopPollingRef.current?.();
		stopPollingRef.current = null;
		forwardedRef.current = new Set();
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
			stopPollingRef.current?.();
		};
	}, []);

	return {
		...state,
		connect,
		disconnect,
	};
}
