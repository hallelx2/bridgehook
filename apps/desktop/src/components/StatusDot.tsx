import { cn } from "../lib/cn";

interface StatusDotProps {
	status: "connected" | "idle" | "disconnected" | "inactive";
	size?: "sm" | "md";
	className?: string;
}

const dotColor: Record<StatusDotProps["status"], string> = {
	connected: "bg-uranium",
	idle: "bg-warn",
	disconnected: "bg-err",
	inactive: "bg-fg-ghost",
};

const dotShadow: Record<StatusDotProps["status"], string> = {
	connected: "shadow-[0_0_8px_rgba(34,211,238,0.6)]",
	idle: "shadow-[0_0_6px_rgba(251,191,36,0.5)]",
	disconnected: "shadow-[0_0_6px_rgba(248,113,113,0.5)]",
	inactive: "",
};

const pulse: Record<StatusDotProps["status"], string> = {
	connected: "animate-pulse-soft",
	idle: "animate-pulse-soft",
	disconnected: "",
	inactive: "",
};

export function StatusDot({ status, size = "md", className }: StatusDotProps) {
	const sz = size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2";
	return (
		<span
			className={cn(
				"inline-block rounded-full",
				sz,
				dotColor[status],
				dotShadow[status],
				pulse[status],
				className,
			)}
			title={status}
			aria-label={status}
		/>
	);
}
