interface StatusDotProps {
	status: "connected" | "idle" | "disconnected" | "inactive";
	size?: "sm" | "md";
}

const colors: Record<StatusDotProps["status"], string> = {
	connected: "bg-green-500",
	idle: "bg-yellow-500",
	disconnected: "bg-red-500",
	inactive: "bg-gray-500",
};

const ringColors: Record<StatusDotProps["status"], string> = {
	connected: "ring-green-500/30",
	idle: "ring-yellow-500/30",
	disconnected: "ring-red-500/30",
	inactive: "ring-gray-500/20",
};

const glowClasses: Record<StatusDotProps["status"], string> = {
	connected: "animate-glow-green",
	idle: "animate-glow-yellow",
	disconnected: "animate-glow-red",
	inactive: "",
};

export function StatusDot({ status, size = "md" }: StatusDotProps) {
	const sizeClass = size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5";
	const ringSize = size === "sm" ? "ring-2" : "ring-[3px]";

	return (
		<span
			className={`inline-block rounded-full ${colors[status]} ${sizeClass} ${ringSize} ${ringColors[status]} ${glowClasses[status]}`}
			title={status}
		/>
	);
}
