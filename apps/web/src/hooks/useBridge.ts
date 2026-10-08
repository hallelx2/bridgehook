import { useCallback, useEffect, useRef, useState } from "react";
import { deleteChannelKey, getChannelPrivateKey } from "../lib/crypto";
import { type LocalhostState, QueueDrainer } from "../lib/drain";
import type { WebhookEventData } from "../lib/relay";
import {
	claimEvent,
	findOrCreateChannelForPort,
	forwardForDrain,
	getChannel,
	getClientId,
	getEvents,
	getPendingEvents,
	pollEvents,
	probeLocalhost,
	safeParseJson,
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

export interface MockConfig {
	enabled: boolean;
	status: number;
	body: string;
	headers: Record<string, string>;
}

type Status = "idle" | "connecting" | "connected" | "reconnecting" | "error";

interface BridgeState {
	status: Status;
	channelId: string | null;
	webhookUrl: string | null;
	port: number;
	allowedPaths: string[];
	events: LiveEvent[];
	error: string | null;
	pollFailures: number;
	mock: MockConfig;
	secrets: Record<string, string>;
	/** Whether this tab can reach and read the local server (no-install mode). */
	localhost: { state: LocalhostState; message: string | null };
}

interface StoredChannel {
	channelId: string;
	port: number;
	allowedPaths: string[];
}

const STORE_KEY = "bh_channel_v1";
const MOCK_KEY = "bh_mock_v1";
const SECRETS_KEY = "bh_secrets_v1";

const DEFAULT_MOCK: MockConfig = {
	enabled: false,
	status: 200,
	body: '{"received":true}',
	headers: { "content-type": "application/json" },
};

// Headers the browser manages or the relay injects — stripped before
// replaying so fetch() doesn't reject the call.
const REPLAY_SKIP_HEADERS = new Set([
	"host",
	"content-length",
	"connection",
	"accept-encoding",
	"cf-ray",
	"cf-connecting-ip",
	"cf-ipcountry",
	"cf-visitor",
	"x-real-ip",
	"x-forwarded-proto",
	"x-forwarded-for",
]);

function loadStored<T>(key: string, fallback: T): T {
	if (typeof localStorage === "undefined") return fallback;
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return fallback;
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function saveStored(key: string, value: unknown): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Quota / private mode — ignore silently
	}
}

function clearStored(key: string): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.removeItem(key);
	} catch {
		// ignore
	}
}

function toLiveEvent(e: WebhookEventData): LiveEvent {
	return {
		id: e.id,
		method: e.method,
		path: e.path,
		requestHeaders: safeParseJson<Record<string, string>>(e.requestHeaders, {}),
		requestBody: e.requestBody,
		responseStatus: e.responseStatus,
		responseBody: e.responseBody,
		latencyMs: e.latencyMs,
		error: e.error,
		receivedAt: e.receivedAt,
	};
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	try {
		return JSON.stringify(err);
	} catch {
		return "Unknown error";
	}
}

/**
 * Merge a fresh server-side event snapshot with locally-held events.
 * Preserves local response/error state while the server catches up —
 * avoids the "response flashes in, then disappears" race where polling
 * returns the event before our sendResponse round-trip persists.
 */
function mergeEvents(existing: LiveEvent[], incoming: WebhookEventData[]): LiveEvent[] {
	const byId = new Map(existing.map((e) => [e.id, e]));
	return incoming.map((raw) => {
		const next = toLiveEvent(raw);
		const prev = byId.get(next.id);
		if (!prev) return next;
		if (!next.responseStatus && !next.error && (prev.responseStatus || prev.error)) {
			return {
				...next,
				responseStatus: prev.responseStatus,
				responseBody: prev.responseBody,
				latencyMs: prev.latencyMs,
				error: prev.error,
			};
		}
		return next;
	});
}

function stripReplayHeaders(headers: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		if (!REPLAY_SKIP_HEADERS.has(k.toLowerCase())) out[k] = v;
	}
	return out;
}

export function useBridge() {
	const [state, setState] = useState<BridgeState>(() => ({
		status: "idle",
		channelId: null,
		webhookUrl: null,
		port: 3000,
		allowedPaths: [],
		events: [],
		error: null,
		pollFailures: 0,
		mock: loadStored<MockConfig>(MOCK_KEY, DEFAULT_MOCK),
		secrets: loadStored<Record<string, string>>(SECRETS_KEY, {}),
		localhost: { state: "ok", message: null },
	}));

	const stopPollingRef = useRef<(() => void) | null>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const drainerRef = useRef<QueueDrainer<WebhookEventData> | null>(null);
	const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isMountedRef = useRef(true);

	// Refs for values accessed from long-lived callbacks to avoid stale closures
	const portRef = useRef(state.port);
	const channelIdRef = useRef(state.channelId);
	const mockRef = useRef(state.mock);
	const webhookUrlRef = useRef(state.webhookUrl);
	useEffect(() => {
		webhookUrlRef.current = state.webhookUrl;
	}, [state.webhookUrl]);
	useEffect(() => {
		portRef.current = state.port;
	}, [state.port]);
	useEffect(() => {
		channelIdRef.current = state.channelId;
	}, [state.channelId]);
	useEffect(() => {
		mockRef.current = state.mock;
	}, [state.mock]);

	const safeSetState = useCallback((updater: (s: BridgeState) => BridgeState) => {
		if (!isMountedRef.current) return;
		setState(updater);
	}, []);

	/**
	 * Run the ordered drain now, and again later when it stopped on a problem
	 * (outages and missing CORS do not consume attempts).
	 */
	const wakeDrainRef = useRef<() => void>(() => {});
	const wakeDrain = useCallback(() => wakeDrainRef.current(), []);
	wakeDrainRef.current = () => {
		const drainer = drainerRef.current;
		if (!drainer) return;
		if (drainTimerRef.current) {
			clearTimeout(drainTimerRef.current);
			drainTimerRef.current = null;
		}
		drainer
			.wake()
			.then((result) => {
				if (result === "idle" || drainerRef.current !== drainer) return;
				// retry: local server or relay trouble. blocked: another executor
				// holds the oldest event; its claim goes stale after 60s.
				drainTimerRef.current = setTimeout(
					() => wakeDrainRef.current(),
					result === "retry" ? 5000 : 15000,
				);
			})
			.catch((err) => {
				if (err instanceof DOMException && err.name === "AbortError") return;
				console.warn("drain failed:", err);
				if (drainerRef.current === drainer) {
					drainTimerRef.current = setTimeout(() => wakeDrainRef.current(), 5000);
				}
			});
	};

	const stopDrain = useCallback(() => {
		drainerRef.current?.stop();
		drainerRef.current = null;
		if (drainTimerRef.current) {
			clearTimeout(drainTimerRef.current);
			drainTimerRef.current = null;
		}
	}, []);

	/**
	 * Handle a fresh poll snapshot. Merges server state with local, then
	 * forwards any pending events to localhost — or returns a canned mock
	 * response when mock mode is enabled.
	 */
	const handleNewEvents = useCallback(
		(events: WebhookEventData[]) => {
			if (events.length === 0) {
				safeSetState((s) =>
					s.status === "connecting" || s.status === "reconnecting"
						? { ...s, status: "connected", pollFailures: 0 }
						: { ...s, pollFailures: 0 },
				);
				return;
			}

			safeSetState((s) => ({
				...s,
				events: mergeEvents(s.events, events),
				status: "connected",
				pollFailures: 0,
			}));

			// Forwarding is the drainer's job (ordered, claimed, retried); a
			// snapshot with unanswered events just wakes it.
			if (events.some((e) => e.responseStatus === null && !e.error)) wakeDrain();
		},
		[safeSetState, wakeDrain],
	);

	const handlePollError = useCallback(
		(err: Error) => {
			console.error("Polling error:", err);
			safeSetState((s) => {
				const failures = s.pollFailures + 1;
				const status: Status =
					failures >= 3 && s.status === "connected" ? "reconnecting" : s.status;
				return { ...s, pollFailures: failures, status };
			});
		},
		[safeSetState],
	);

	const bootstrapChannel = useCallback(
		async (
			channelId: string,
			port: number,
			allowedPaths: string[],
			controller: AbortController,
		) => {
			const existing = await getEvents(channelId, 50, controller.signal);
			if (controller.signal.aborted) return;

			const liveEvents = existing.map(toLiveEvent);

			safeSetState((s) => ({
				...s,
				events: liveEvents,
				port,
				allowedPaths,
				status: "connected",
			}));

			stopDrain();
			const signal = controller.signal;
			const patchEvent = (id: string, patch: Partial<LiveEvent>) =>
				safeSetState((s) => ({
					...s,
					events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
				}));
			safeSetState((s) => ({ ...s, localhost: { state: "ok", message: null } }));
			const drainer: QueueDrainer<WebhookEventData> = new QueueDrainer<WebhookEventData>({
				fetchPending: (after) => getPendingEvents(channelId, after, signal),
				claim: async (eventId) => {
					const clientId = getClientId();
					const c = await claimEvent(channelId, eventId, clientId, signal);
					return c.claimed || c.claimerId === clientId;
				},
				probe: async (evt) =>
					mockRef.current.enabled ? { state: "ok" } : probeLocalhost(evt, portRef.current, signal),
				// No bridge signal on the forward or the report: once localhost
				// has the request, leaving the page must not cut it off, or the
				// event would be claimed and run again on return.
				forward: async (evt) => {
					const mock = mockRef.current;
					if (mock.enabled) {
						return {
							kind: "response",
							result: { status: mock.status, headers: mock.headers, body: mock.body, latencyMs: 0 },
						};
					}
					return forwardForDrain(evt, portRef.current);
				},
				report: (evt, result) => sendResponse(channelId, evt.id, result),
				onDelivered: (evt, r) =>
					patchEvent(evt.id, {
						responseStatus: r.status,
						responseBody: r.body,
						latencyMs: r.latencyMs,
						error: null,
					}),
				onSkipped: (evt, message) => patchEvent(evt.id, { error: message }),
				onLocalhost: (localhostState, message) => {
					if (drainerRef.current !== drainer) return;
					safeSetState((s) => ({
						...s,
						localhost: { state: localhostState, message: message ?? null },
					}));
				},
			});
			drainerRef.current = drainer;
			wakeDrain();

			const stopPolling = pollEvents(
				channelId,
				handleNewEvents,
				handlePollError,
				2000,
				controller.signal,
			);
			stopPollingRef.current = stopPolling;
		},
		[handleNewEvents, handlePollError, safeSetState, stopDrain, wakeDrain],
	);

	/** Create a fresh channel, start polling, persist for rehydration. */
	const connect = useCallback(
		async (port: number, allowedPaths: string[]) => {
			stopPollingRef.current?.();
			stopPollingRef.current = null;
			abortControllerRef.current?.abort();

			const controller = new AbortController();
			abortControllerRef.current = controller;

			try {
				safeSetState((s) => ({
					...s,
					status: "connecting",
					port,
					allowedPaths,
					error: null,
				}));
				stopDrain();

				// Stable URL per (user, port): when signed in, reuses an
				// existing channel for this port instead of minting a new
				// one. Signed-out callers get the same legacy behavior as
				// before (fresh channel each time).
				const channel = await findOrCreateChannelForPort(port, allowedPaths);
				if (controller.signal.aborted) return;

				safeSetState((s) => ({
					...s,
					channelId: channel.channelId,
					webhookUrl: channel.webhookUrl,
				}));

				saveStored(STORE_KEY, {
					channelId: channel.channelId,
					port,
					allowedPaths,
				} satisfies StoredChannel);

				await bootstrapChannel(channel.channelId, port, allowedPaths, controller);
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") return;
				safeSetState((s) => ({
					...s,
					status: "error",
					error: errorMessage(err),
				}));
			}
		},
		[bootstrapChannel, safeSetState, stopDrain],
	);

	const disconnect = useCallback(() => {
		stopPollingRef.current?.();
		stopPollingRef.current = null;
		abortControllerRef.current?.abort();
		abortControllerRef.current = null;
		stopDrain();
		clearStored(STORE_KEY);
		// Fire-and-forget IDB key cleanup — the channel is already unusable
		// without the key, and this reclaims storage.
		const previousChannelId = channelIdRef.current;
		if (previousChannelId) {
			deleteChannelKey(previousChannelId).catch(() => {
				/* ignore */
			});
		}
		safeSetState((s) => ({
			status: "idle",
			channelId: null,
			webhookUrl: null,
			port: 3000,
			allowedPaths: [],
			events: [],
			error: null,
			pollFailures: 0,
			mock: s.mock,
			secrets: s.secrets,
			localhost: { state: "ok", message: null },
		}));
	}, [safeSetState, stopDrain]);

	/**
	 * On mount, rehydrate a previously-active channel if one is stored.
	 * If the channel has expired server-side, wipe localStorage and fall
	 * back to the connect form.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional run-once-on-mount
	useEffect(() => {
		const stored = loadStored<StoredChannel | null>(STORE_KEY, null);
		if (!stored) return;

		const controller = new AbortController();
		abortControllerRef.current = controller;

		(async () => {
			safeSetState((s) => ({ ...s, status: "connecting" }));
			try {
				// If the private key was wiped (IDB cleared, different browser profile,
				// etc.) there's no way to authenticate anymore — drop the stub.
				const privateKey = await getChannelPrivateKey(stored.channelId);
				if (!privateKey) {
					clearStored(STORE_KEY);
					safeSetState((s) => ({ ...s, status: "idle" }));
					return;
				}

				const channel = await getChannel(stored.channelId);
				if (controller.signal.aborted) return;
				if (!channel) {
					clearStored(STORE_KEY);
					safeSetState((s) => ({ ...s, status: "idle" }));
					return;
				}

				safeSetState((s) => ({
					...s,
					channelId: channel.channelId,
					webhookUrl: channel.webhookUrl,
					port: stored.port,
					allowedPaths: stored.allowedPaths,
				}));

				await bootstrapChannel(channel.channelId, stored.port, stored.allowedPaths, controller);
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") return;
				clearStored(STORE_KEY);
				safeSetState((s) => ({
					...s,
					status: "idle",
					error: errorMessage(err),
				}));
			}
		})();

		return () => {
			controller.abort();
		};
		// Intentional empty deps — rehydration runs once on mount only.
	}, []);

	/**
	 * Replay an event by POSTing its original request back to the relay URL.
	 * The fresh call flows through normal polling, so the replay appears
	 * as a new row with its own latency and response.
	 */
	const replay = useCallback(async (event: LiveEvent) => {
		const url = channelUrl(webhookUrlRef.current, event.path);
		const headers = stripReplayHeaders(event.requestHeaders);
		await fetch(url, {
			method: event.method,
			headers,
			body: event.requestBody || undefined,
		});
	}, []);

	/** Replay with modified body and/or headers. Produces a new feed row. */
	const replayWithEdits = useCallback(
		async (event: LiveEvent, edits: { body?: string; headers?: Record<string, string> }) => {
			const url = channelUrl(webhookUrlRef.current, event.path);
			const base = stripReplayHeaders(event.requestHeaders);
			const merged = { ...base, ...(edits.headers ?? {}) };
			await fetch(url, {
				method: event.method,
				headers: merged,
				body: edits.body ?? event.requestBody ?? undefined,
			});
		},
		[],
	);

	const setMock = useCallback(
		(update: Partial<MockConfig>) => {
			safeSetState((s) => {
				const mock = { ...s.mock, ...update };
				saveStored(MOCK_KEY, mock);
				return { ...s, mock };
			});
		},
		[safeSetState],
	);

	const setSecret = useCallback(
		(provider: string, secret: string) => {
			safeSetState((s) => {
				const secrets = { ...s.secrets };
				if (secret) secrets[provider] = secret;
				else delete secrets[provider];
				saveStored(SECRETS_KEY, secrets);
				return { ...s, secrets };
			});
		},
		[safeSetState],
	);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
			stopDrain();
			stopPollingRef.current?.();
			stopPollingRef.current = null;
			abortControllerRef.current?.abort();
			abortControllerRef.current = null;
		};
	}, [stopDrain]);

	return {
		...state,
		connect,
		disconnect,
		replay,
		replayWithEdits,
		setMock,
		setSecret,
	};
}

/**
 * Where a replay goes: the channel's own webhook URL plus the event's path.
 * Events store the path localhost receives (`/stripe/webhook?x=1`); older rows
 * may still carry the legacy `/hook/<id>` prefix, which is dropped.
 */
function channelUrl(webhookUrl: string | null, path: string): string {
	if (!webhookUrl) throw new Error("No active channel to replay to");
	const clean = path.replace(/^\/hook\/[a-z0-9]+(?=\/|$|\?)/, "") || "/";
	return `${webhookUrl.replace(/\/$/, "")}${clean === "/" ? "" : clean}`;
}
