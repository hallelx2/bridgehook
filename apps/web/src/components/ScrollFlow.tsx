import { useEffect, useRef, useState } from "react";

/**
 * A single continuous SVG meandering path connects all 5 flow nodes.
 * Cards sit alternating left/right alongside the path.
 * On scroll, a glowing gradient stroke travels along the path and
 * lights up each node as it passes.
 */

const STEPS = [
	{
		icon: "webhook",
		title: "Webhook Fires",
		desc: "Stripe, GitHub, or any provider sends a POST to your unique BridgeHook URL.",
		code: "POST https://hook.bridgehook.dev/ch_9x4kf2m",
		color: "#ffb0cd",
	},
	{
		icon: "cloud",
		title: "Relay Receives",
		desc: "Our Cloudflare Edge relay catches the request globally with <50ms latency and buffers it.",
		code: "Event buffered → SSE broadcast",
		color: "#9093ff",
	},
	{
		icon: "cell_tower",
		title: "SSE Pushes to Browser",
		desc: "The relay streams the event to your browser tab in real-time via Server-Sent Events.",
		code: "EventSource → data: { method, headers, body }",
		color: "#ddb7ff",
	},
	{
		icon: "code",
		title: "Browser Forwards",
		desc: "Your browser's JavaScript calls fetch() to forward the exact request to your local dev server.",
		code: 'fetch("http://localhost:3000/webhook/stripe")',
		color: "#28c840",
	},
	{
		icon: "check_circle",
		title: "Response Returns",
		desc: "Your server's response flows back through the relay to the original webhook sender.",
		code: '← 200 OK { "received": true }',
		color: "#fcd34d",
	},
];

/**
 * Y positions for each node center along the SVG.
 * SVG viewBox is 200 wide, height is calculated from node count.
 */
const NODE_SPACING = 220;
const SVG_WIDTH = 200;
const SVG_HEIGHT = (STEPS.length - 1) * NODE_SPACING + 40;

/** X positions alternate: left-center, right-center, left-center... */
function nodeX(i: number) {
	return i % 2 === 0 ? 60 : 140;
}
function nodeY(i: number) {
	return 20 + i * NODE_SPACING;
}

/** Build a smooth meandering cubic bezier path through all nodes */
function buildPath(): string {
	const parts: string[] = [];
	for (let i = 0; i < STEPS.length; i++) {
		const x = nodeX(i);
		const y = nodeY(i);
		if (i === 0) {
			parts.push(`M ${x} ${y}`);
		} else {
			const prevX = nodeX(i - 1);
			const prevY = nodeY(i - 1);
			const midY = (prevY + y) / 2;
			// S-curve: control points push horizontally toward the opposite side
			parts.push(`C ${prevX} ${midY}, ${x} ${midY}, ${x} ${y}`);
		}
	}
	return parts.join(" ");
}

const PATH_D = buildPath();

export function ScrollFlow() {
	const sectionRef = useRef<HTMLDivElement>(null);
	const pathRef = useRef<SVGPathElement>(null);
	const glowRef = useRef<SVGPathElement>(null);
	const [progress, setProgress] = useState(0);
	const [pathLength, setPathLength] = useState(0);

	// Measure path length once
	useEffect(() => {
		if (pathRef.current) {
			setPathLength(pathRef.current.getTotalLength());
		}
	}, []);

	// Scroll-driven progress
	useEffect(() => {
		const section = sectionRef.current;
		if (!section) return;

		const handleScroll = () => {
			const rect = section.getBoundingClientRect();
			const vh = window.innerHeight;
			const start = vh * 0.8;
			const end = -(rect.height - vh * 0.3);
			const p = (start - rect.top) / (start - end);
			setProgress(Math.max(0, Math.min(1, p)));
		};

		window.addEventListener("scroll", handleScroll, { passive: true });
		handleScroll();
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	// Which node is active based on progress
	const activeIndex = Math.min(Math.floor(progress * STEPS.length), STEPS.length - 1);

	// Stroke dashoffset for the reveal
	const revealLength = pathLength * progress;
	const dashOffset = pathLength - revealLength;

	return (
		<section ref={sectionRef} id="flow" className="max-w-5xl mx-auto px-4 md:px-8 py-32 relative">
			{/* Background glow */}
			<div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[800px] bg-primary/[0.03] rounded-full blur-[120px] pointer-events-none" />

			{/* Header */}
			<div className="text-center mb-20 relative z-10">
				<div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.06] text-[10px] font-bold text-tertiary tracking-[0.2em] uppercase mb-6 font-label">
					<span className="material-symbols-outlined text-tertiary text-sm">route</span>
					Request Flow
				</div>
				<h2 className="text-4xl md:text-6xl font-black text-white tracking-tighter font-headline mb-4">
					See every step
				</h2>
				<p className="text-zinc-400 text-lg max-w-xl mx-auto leading-relaxed font-body">
					Scroll to trace a webhook from the moment it fires to the response your server sends back.
					Every hop, visualized.
				</p>
			</div>

			{/* Flow container: SVG path + positioned cards */}
			<div
				className="relative z-10 mx-auto"
				style={{
					maxWidth: "900px",
					height: `${(STEPS.length - 1) * 240 + 120}px`,
				}}
			>
				{/* SVG meandering path */}
				<svg
					viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
					className="absolute left-1/2 -translate-x-1/2 top-0 h-full pointer-events-none"
					style={{ width: "200px" }}
					preserveAspectRatio="none"
					fill="none"
				>
					{/* Background track */}
					<path
						d={PATH_D}
						stroke="rgba(255,255,255,0.04)"
						strokeWidth="2"
						strokeLinecap="round"
						fill="none"
					/>
					{/* Revealed glow path */}
					{pathLength > 0 && (
						<path
							ref={glowRef}
							d={PATH_D}
							stroke="url(#flowGradient)"
							strokeWidth="2.5"
							strokeLinecap="round"
							fill="none"
							strokeDasharray={pathLength}
							strokeDashoffset={dashOffset}
							style={{ transition: "stroke-dashoffset 0.3s ease-out" }}
						/>
					)}
					{/* Invisible path for measurement */}
					<path ref={pathRef} d={PATH_D} stroke="transparent" strokeWidth="1" fill="none" />

					{/* Node dots on the path */}
					{STEPS.map((step, i) => {
						const isActive = i <= activeIndex;
						return (
							<g key={step.title}>
								{/* Outer glow */}
								{isActive && (
									<circle cx={nodeX(i)} cy={nodeY(i)} r="12" fill={step.color} opacity="0.15">
										<animate
											attributeName="r"
											values="10;16;10"
											dur="2s"
											repeatCount="indefinite"
										/>
										<animate
											attributeName="opacity"
											values="0.15;0.3;0.15"
											dur="2s"
											repeatCount="indefinite"
										/>
									</circle>
								)}
								{/* Main dot */}
								<circle
									cx={nodeX(i)}
									cy={nodeY(i)}
									r="6"
									fill={isActive ? step.color : "#18181b"}
									stroke={isActive ? step.color : "rgba(255,255,255,0.1)"}
									strokeWidth="2"
									style={{ transition: "all 0.5s ease" }}
								/>
							</g>
						);
					})}

					{/* Traveling dot */}
					{pathLength > 0 && progress > 0 && (
						<circle r="4" fill="#fff" opacity="0.9">
							<animateMotion
								dur="3s"
								repeatCount="indefinite"
								keyPoints={`${Math.max(0, progress - 0.05)};${progress}`}
								keyTimes="0;1"
								calcMode="linear"
							>
								<mpath href="#flowPathRef" />
							</animateMotion>
						</circle>
					)}
					<path id="flowPathRef" d={PATH_D} stroke="transparent" fill="none" />

					<defs>
						<linearGradient id="flowGradient" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor="#ffb0cd" />
							<stop offset="25%" stopColor="#9093ff" />
							<stop offset="50%" stopColor="#ddb7ff" />
							<stop offset="75%" stopColor="#28c840" />
							<stop offset="100%" stopColor="#fcd34d" />
						</linearGradient>
					</defs>
				</svg>

				{/* Cards positioned alongside the path */}
				{STEPS.map((step, i) => {
					const isLeft = i % 2 === 0;
					const isActive = i <= activeIndex;
					const topPos = i * 240;

					return (
						<div
							key={step.title}
							className={`absolute transition-all duration-700 w-[calc(50%-60px)] ${
								isActive ? "opacity-100 translate-y-0" : "opacity-15 translate-y-3"
							}`}
							style={{
								top: `${topPos}px`,
								...(isLeft ? { left: 0 } : { right: 0 }),
							}}
						>
							<div
								className={`bg-[#111113] border rounded-xl p-7 transition-all duration-500 ${
									isActive
										? "border-white/10 shadow-[0_0_50px_-15px_var(--glow)]"
										: "border-white/[0.04]"
								}`}
								style={
									{
										"--glow": `${step.color}30`,
									} as React.CSSProperties
								}
							>
								{/* Icon + step label */}
								<div className="flex items-center gap-3 mb-4">
									<div
										className="w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-500"
										style={{
											background: isActive ? `${step.color}12` : "rgba(255,255,255,0.03)",
											border: `1px solid ${isActive ? `${step.color}25` : "rgba(255,255,255,0.06)"}`,
										}}
									>
										<span
											className="material-symbols-outlined text-lg transition-colors duration-500"
											style={{
												color: isActive ? step.color : "#3f3f46",
											}}
										>
											{step.icon}
										</span>
									</div>
									<span className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.25em] font-label">
										Step {i + 1}
									</span>
								</div>

								{/* Title */}
								<h3 className="text-xl font-black text-white tracking-tight font-headline mb-2">
									{step.title}
								</h3>

								{/* Description */}
								<p className="text-zinc-400 text-[13px] leading-relaxed mb-4 font-body">
									{step.desc}
								</p>

								{/* Code snippet */}
								<div
									className="font-mono text-[11px] px-3 py-2 rounded-lg transition-all duration-500"
									style={{
										background: isActive ? `${step.color}08` : "rgba(255,255,255,0.02)",
										color: isActive ? step.color : "#3f3f46",
										border: `1px solid ${isActive ? `${step.color}18` : "rgba(255,255,255,0.04)"}`,
									}}
								>
									{step.code}
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}
