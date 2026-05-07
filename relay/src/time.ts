/** Tiny date helpers — no Node deps. */

export function addDays(date: Date, days: number): Date {
	const out = new Date(date);
	out.setUTCDate(out.getUTCDate() + days);
	return out;
}

export function addHours(date: Date, hours: number): Date {
	return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function addMinutes(date: Date, minutes: number): Date {
	return new Date(date.getTime() + minutes * 60 * 1000);
}
