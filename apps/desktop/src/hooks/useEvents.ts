import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

export interface WebhookEvent {
	id: string;
	service_id: string;
	method: string;
	path: string;
	request_headers: string;
	request_body: string | null;
	response_status: number | null;
	response_headers: string | null;
	response_body: string | null;
	latency_ms: number | null;
	error: string | null;
	received_at: string;
}

export interface WebhookEventPayload {
	id: string;
	service_id: string;
	service_name: string;
	method: string;
	path: string;
	request_headers: Record<string, string>;
	request_body: string | null;
	response_status: number | null;
	response_body: string | null;
	latency_ms: number | null;
	error: string | null;
	received_at: string;
}

export interface ReplayResult {
	status: number;
	headers: Record<string, string>;
	body: string;
	latency_ms: number;
}

const MAX_LIVE_EVENTS = 200;

export function useEvents(serviceId?: string) {
	const [events, setEvents] = useState<WebhookEventPayload[]>([]);
	const [loading, setLoading] = useState(true);

	// Load historical events from SQLite
	const loadHistory = useCallback(async () => {
		try {
			const result = await invoke<WebhookEvent[]>("get_events", {
				serviceId: serviceId ?? null,
				limit: 100,
				offset: 0,
			});
			// Convert stored events to payload format
			const payloads: WebhookEventPayload[] = result.map((e) => ({
				id: e.id,
				service_id: e.service_id,
				service_name: "",
				method: e.method,
				path: e.path,
				request_headers: JSON.parse(e.request_headers || "{}"),
				request_body: e.request_body,
				response_status: e.response_status,
				response_body: e.response_body,
				latency_ms: e.latency_ms,
				error: e.error,
				received_at: e.received_at,
			}));
			setEvents(payloads);
		} catch (err) {
			console.error("Failed to load events:", err);
		} finally {
			setLoading(false);
		}
	}, [serviceId]);

	useEffect(() => {
		loadHistory();
	}, [loadHistory]);

	// Listen for real-time events from the Rust bridge
	useEffect(() => {
		const unlisten = listen<WebhookEventPayload>("webhook-event", (event) => {
			setEvents((prev) => [event.payload, ...prev].slice(0, MAX_LIVE_EVENTS));
		});
		return () => {
			unlisten.then((fn_) => fn_());
		};
	}, []);

	const replayEvent = useCallback(async (eventId: string) => {
		return invoke<ReplayResult>("replay_event", { eventId });
	}, []);

	return { events, loading, replayEvent, refresh: loadHistory };
}
