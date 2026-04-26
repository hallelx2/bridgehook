/**
 * Small formatting helpers used across the dashboard.
 */

const UNITS: [number, string][] = [
	[60, "s"],
	[60, "m"],
	[24, "h"],
	[7, "d"],
];

/**
 * Relative time from `iso` to now. Returns "just now", "12s ago", "4m ago", …
 * Falls back to the absolute locale time if the date is invalid.
 */
export function relativeTime(iso: string, now = Date.now()): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "—";
	let seconds = Math.floor((now - then) / 1000);
	if (seconds < 2) return "just now";

	let unit = "s";
	for (const [factor, next] of UNITS) {
		if (seconds < factor) break;
		seconds = Math.floor(seconds / factor);
		unit = next;
	}
	return `${seconds}${unit} ago`;
}

/** Absolute HH:MM:SS. Used in tooltips where space allows. */
export function absoluteTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "—";
	return d.toLocaleTimeString();
}

/** Try to pretty-print any string. Returns the original if not JSON. */
export function prettyJson(value: string | null | undefined): string {
	if (!value) return "";
	try {
		return JSON.stringify(JSON.parse(value), null, 2);
	} catch {
		return value;
	}
}

/** Safely parse JSON into a typed fallback. */
export function safeParse<T>(value: string | null | undefined, fallback: T): T {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

/** Human-readable byte count: 1024 → 1.0 KB */
export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
