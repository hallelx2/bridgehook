/**
 * Caches the relay's /api/config probe so the app can decide between
 * hosted (auth-on) and self-host (auth-off) UI without spamming the
 * endpoint. Result is in-memory for the page's lifetime; refreshed on
 * full reload only.
 */
import { useEffect, useState } from "react";

const RELAY_URL = import.meta.env.VITE_RELAY_URL || "http://localhost:8787";

export interface RelayConfig {
	authEnabled: boolean;
	signupEnabled: boolean;
	trialDays: number;
	version: string;
}

const FALLBACK_CONFIG: RelayConfig = {
	authEnabled: false,
	signupEnabled: false,
	trialDays: 0,
	version: "unknown",
};

let inflight: Promise<RelayConfig> | null = null;
let cached: RelayConfig | null = null;

export function getConfig(): Promise<RelayConfig> {
	if (cached) return Promise.resolve(cached);
	if (inflight) return inflight;

	inflight = (async () => {
		try {
			const res = await fetch(`${RELAY_URL}/api/config`, { credentials: "include" });
			if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
			const data = (await res.json()) as RelayConfig;
			cached = data;
			return data;
		} catch (err) {
			console.warn("[config] falling back to self-host shape:", err);
			cached = FALLBACK_CONFIG;
			return FALLBACK_CONFIG;
		} finally {
			inflight = null;
		}
	})();
	return inflight;
}

/**
 * Reactive hook for components that need the config to render. Returns
 * { config: null, loading: true } on first paint, then the real value.
 */
export function useConfig(): { config: RelayConfig | null; loading: boolean } {
	const [config, setConfig] = useState<RelayConfig | null>(cached);
	const [loading, setLoading] = useState(cached === null);

	useEffect(() => {
		if (cached) {
			setConfig(cached);
			setLoading(false);
			return;
		}
		let alive = true;
		getConfig().then((c) => {
			if (alive) {
				setConfig(c);
				setLoading(false);
			}
		});
		return () => {
			alive = false;
		};
	}, []);

	return { config, loading };
}
