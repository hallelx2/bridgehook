import { useMemo } from "react";
import { cn } from "../lib/cn";

interface SparklineProps {
	values: number[];
	width?: number;
	height?: number;
	className?: string;
	color?: string;
	/** Render as bars instead of a line (good for bucketed counts). */
	bars?: boolean;
}

/**
 * Tiny inline SVG sparkline — no dependencies.
 * Pass a series of numeric values; empty/zero produces a flat line.
 */
export function Sparkline({
	values,
	width = 80,
	height = 20,
	className,
	color = "#ccff00",
	bars = false,
}: SparklineProps) {
	const { path, rects, max } = useMemo(() => {
		if (values.length === 0) return { path: "", rects: [], max: 0 };
		const max = Math.max(1, ...values);
		const step = values.length > 1 ? width / (values.length - 1) : width;
		if (bars) {
			const bw = Math.max(1, width / values.length - 1);
			const rects = values.map((v, i) => {
				const h = (v / max) * height;
				return { x: i * (bw + 1), y: height - h, w: bw, h };
			});
			return { path: "", rects, max };
		}
		const d = values
			.map((v, i) => {
				const x = i * step;
				const y = height - (v / max) * height;
				return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(" ");
		return { path: d, rects: [], max };
	}, [values, width, height, bars]);

	if (values.length === 0) {
		return (
			<svg width={width} height={height} className={className} aria-hidden="true">
				<line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#272a37" strokeWidth={1} />
			</svg>
		);
	}

	return (
		<svg
			width={width}
			height={height}
			className={cn("overflow-visible", className)}
			aria-label={`Sparkline, peak ${max}`}
		>
			{bars ? (
				rects.map((r) => (
					<rect
						key={`${r.x}-${r.y}`}
						x={r.x}
						y={r.y}
						width={r.w}
						height={r.h}
						fill={color}
						opacity={0.85}
					/>
				))
			) : (
				<path d={path} stroke={color} strokeWidth={1.25} fill="none" />
			)}
		</svg>
	);
}
