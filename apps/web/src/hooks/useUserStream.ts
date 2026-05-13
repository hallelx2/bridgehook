import { useEffect, useRef } from "react";
import { type MeStreamEvent, streamMeEvents } from "../lib/me-api";

/**
 * Subscribe to the per-user SSE stream (/api/me/stream) for the lifetime
 * of the calling component. The callback is held in a ref so the caller
 * can pass a fresh closure each render without tearing down the
 * EventSource — only mount/unmount does that.
 *
 * On self-host instances the endpoint 404s; `streamMeEvents` swallows
 * the error silently, so it's safe to call unconditionally. Callers
 * should still run their own polling fallback to bridge transient
 * disconnects.
 */
export function useUserStream(onEvent: (e: MeStreamEvent) => void, enabled = true): void {
	const handler = useRef(onEvent);
	handler.current = onEvent;

	useEffect(() => {
		if (!enabled) return;
		const handle = streamMeEvents(
			(e) => handler.current(e),
			() => {
				/* error fires repeatedly during reconnect — callers' own
				   polling fallback (or the browser's auto-reconnect) covers
				   the gap, no need to surface it here */
			},
		);
		return () => handle.close();
	}, [enabled]);
}
