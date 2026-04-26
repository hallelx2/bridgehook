export function formatTime(iso: string): string {
	try {
		return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
	} catch {
		return iso;
	}
}

export function formatRelative(iso: string): string {
	try {
		const then = new Date(iso).getTime();
		const diff = Date.now() - then;
		if (diff < 1000) return "now";
		if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
		return `${Math.floor(diff / 86_400_000)}d ago`;
	} catch {
		return iso;
	}
}

export function tryPrettyJson(str: string | null | undefined): string {
	if (!str) return "";
	try {
		return JSON.stringify(JSON.parse(str), null, 2);
	} catch {
		return str;
	}
}

export function safeParseJson<T = unknown>(str: string | null | undefined): T | null {
	if (!str) return null;
	try {
		return JSON.parse(str) as T;
	} catch {
		return null;
	}
}

export function truncateMiddle(s: string, keepStart = 6, keepEnd = 4): string {
	if (s.length <= keepStart + keepEnd + 1) return s;
	return `${s.slice(0, keepStart)}…${s.slice(-keepEnd)}`;
}
