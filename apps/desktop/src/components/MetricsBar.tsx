import { useMemo } from "react";
import type { WebhookEventPayload } from "../hooks/useEvents";
import { cn } from "../lib/cn";
import { Sparkline } from "./Sparkline";

interface MetricsBarProps {
	events: WebhookEventPayload[];
	/** Window in ms for rate computation. Default 60_000 (1m). */
	windowMs?: number;
}

/**
 * Computes p50/p95 latency, success rate, events/min, and a sparkline
 * from the in-memory event buffer. No backend needed.
 */
export function MetricsBar({ events, windowMs = 60_000 }: MetricsBarProps) {
	const metrics = useMemo(() => {
		const now = Date.now();
		const recent = events.filter((e) => {
			const t = new Date(e.received_at).getTime();
			return !Number.isNaN(t) && now - t <= windowMs;
		});

		const latencies = recent
			.map((e) => e.latency_ms)
			.filter((l): l is number => typeof l === "number")
			.sort((a, b) => a - b);
		const p50 = percentile(latencies, 0.5);
		const p95 = percentile(latencies, 0.95);

		const successCount = recent.filter(
			(e) => e.response_status != null && e.response_status < 400,
		).length;
		const successRate = recent.length === 0 ? null : successCount / recent.length;

		const buckets = new Array(12).fill(0) as number[];
		for (const e of recent) {
			const t = new Date(e.received_at).getTime();
			const idx = Math.min(11, Math.floor((windowMs - (now - t)) / (windowMs / 12)));
			if (idx >= 0 && idx < 12) buckets[idx]++;
		}

		return {
			perMin: recent.length,
			p50,
			p95,
			successRate,
			buckets,
		};
	}, [events, windowMs]);

	return (
		<div className="flex items-center gap-3 text-micro tabular">
			<Stat label="rate" value={`${metrics.perMin}/m`} />
			<Stat
				label="ok"
				value={metrics.successRate == null ? "—" : `${Math.round(metrics.successRate * 100)}%`}
				tone={
					metrics.successRate == null
						? "neutral"
						: metrics.successRate >= 0.95
							? "ok"
							: metrics.successRate >= 0.8
								? "warn"
								: "danger"
				}
			/>
			<Stat label="p50" value={metrics.p50 == null ? "—" : `${metrics.p50}`} suffix="ms" />
			<Stat label="p95" value={metrics.p95 == null ? "—" : `${metrics.p95}`} suffix="ms" />
			<Sparkline values={metrics.buckets} width={64} height={14} bars color="#ccff00" />
		</div>
	);
}

function percentile(sorted: number[], p: number): number | null {
	if (sorted.length === 0) return null;
	const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
	return sorted[idx];
}

function Stat({
	label,
	value,
	suffix,
	tone = "neutral",
}: {
	label: string;
	value: string;
	suffix?: string;
	tone?: "neutral" | "ok" | "warn" | "danger";
}) {
	const toneCls =
		tone === "ok"
			? "text-ok"
			: tone === "warn"
				? "text-warn"
				: tone === "danger"
					? "text-err"
					: "text-fg";
	return (
		<div className="flex items-baseline gap-1">
			<span className="text-fg-ghost uppercase tracking-widest">{label}</span>
			<span className={cn("font-semibold tabular", toneCls)}>{value}</span>
			{suffix && <span className="text-fg-faint">{suffix}</span>}
		</div>
	);
}
