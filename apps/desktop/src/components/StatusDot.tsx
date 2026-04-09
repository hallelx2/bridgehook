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

export function StatusDot({ status, size = "md" }: StatusDotProps) {
	const sizeClass = size === "sm" ? "w-2 h-2" : "w-3 h-3";
	const pulseClass = status === "connected" ? "animate-pulse" : "";

	return (
		<span
			className={`inline-block rounded-full ${colors[status]} ${sizeClass} ${pulseClass}`}
			title={status}
		/>
	);
}
