/**
 * BridgeHook logo system.
 *
 * Wordmark: "bridgehook" in Manrope extrabold with tight tracking.
 * "bridge" in white, "hook" in primary purple. Lowercase, no spaces.
 * This is the primary brand mark used everywhere.
 *
 * Icon: Bridge arch + hook curl SVG for favicon/compact contexts.
 */

interface LogoProps {
	size?: "sm" | "md" | "lg" | "xl";
	showIcon?: boolean;
	className?: string;
}

const SIZES = {
	sm: { text: "text-lg", icon: 18, gap: "gap-2" },
	md: { text: "text-xl", icon: 22, gap: "gap-2.5" },
	lg: { text: "text-2xl", icon: 26, gap: "gap-2.5" },
	xl: { text: "text-3xl", icon: 32, gap: "gap-3" },
};

export function BridgeHookIcon({
	size = 24,
	className = "",
}: { size?: number; className?: string }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 32 32"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
		>
			<path
				d="M4 24V16C4 9.373 9.373 4 16 4C22.627 4 28 9.373 28 16V20"
				stroke="currentColor"
				strokeWidth="3.5"
				strokeLinecap="round"
			/>
			<path
				d="M4 20V28"
				stroke="currentColor"
				strokeWidth="3.5"
				strokeLinecap="round"
			/>
			<path
				d="M28 20V24C28 26.209 26.209 28 24 28H22"
				stroke="url(#hook-grad)"
				strokeWidth="3.5"
				strokeLinecap="round"
			/>
			<defs>
				<linearGradient id="hook-grad" x1="28" y1="20" x2="22" y2="28">
					<stop stopColor="currentColor" />
					<stop offset="1" stopColor="#9093ff" />
				</linearGradient>
			</defs>
		</svg>
	);
}

export function Logo({
	size = "md",
	showIcon = false,
	className = "",
}: LogoProps) {
	const s = SIZES[size];

	return (
		<div className={`flex items-center ${s.gap} ${className}`}>
			{showIcon && (
				<BridgeHookIcon size={s.icon} className="text-white" />
			)}
			<span
				className={`font-headline font-extrabold tracking-[-0.04em] leading-none ${s.text}`}
			>
				<span className="text-white">bridge</span>
				<span className="text-primary">hook</span>
			</span>
		</div>
	);
}

export function LogoIcon({
	size = 32,
	withBackground = false,
}: { size?: number; withBackground?: boolean }) {
	if (withBackground) {
		return (
			<div
				className="flex items-center justify-center rounded-xl bg-[#09090b]"
				style={{ width: size, height: size }}
			>
				<BridgeHookIcon
					size={Math.round(size * 0.6)}
					className="text-white"
				/>
			</div>
		);
	}
	return <BridgeHookIcon size={size} className="text-white" />;
}
