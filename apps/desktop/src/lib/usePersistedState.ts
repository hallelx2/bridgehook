import { useEffect, useState } from "react";

/**
 * useState-like hook that persists to localStorage.
 * Safe on SSR / Tauri boot (falls back to initial value if storage fails).
 */
export function usePersistedState<T>(
	key: string,
	initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
	const [value, setValue] = useState<T>(() => {
		if (typeof window === "undefined") return initial;
		try {
			const raw = window.localStorage.getItem(key);
			if (raw == null) return initial;
			return JSON.parse(raw) as T;
		} catch {
			return initial;
		}
	});

	useEffect(() => {
		try {
			window.localStorage.setItem(key, JSON.stringify(value));
		} catch {
			/* quota/disabled — fine */
		}
	}, [key, value]);

	return [value, setValue];
}
