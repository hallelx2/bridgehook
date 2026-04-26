import { CheckCircle2, Cloud, Code2, RadioTower, Route, Webhook } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * A single continuous SVG meandering path connects all 5 flow nodes.
 * Cards sit alternating left/right alongside the path.
 * On scroll, a single-accent gradient stroke travels along the path and
 * lights up each node as it passes. (Previously 5 distinct colors — now one.)
 */
const STEPS: { Icon: LucideIcon; title: string; desc: string; code: string }[] = [
	{
		Icon: Webhook,
		title: "Webhook fires",
		desc: "Stripe, GitHub, or any provider sends a POST to your unique BridgeHook URL.",
		code: "POST https://hook.bridgehook.dev/ch_9x4kf2m",
	},
	{
		Icon: Cloud,
		title: "Relay receives",
		desc: "Our Cloudflare Edge relay catches the request globally with <50ms latency and buffers it.",
		code: "Event buffered → streamed to browser",
	},
	{
		Icon: RadioTower,
		title: "Pushes to your browser",
		desc: "The relay streams the event to your browser tab in real time.",
		code: "EventSource → { method, headers, body }",
	},
	{
		Icon: Code2,
		title: "Browser forwards",
		desc: "Your browser's JavaScript calls fetch() to forward the exact request to your local dev server.",
		code: 'fetch("http://localhost:3000/webhook/stripe")',
	},
	{
		Icon: CheckCircle2,
		title: "Response returns",
		desc: "Your server's response flows back through the relay to the original webhook sender.",
		code: '← 200 OK { "received": true }',
	},
];

const NODE_SPACING = 220;
const SVG_WIDTH = 200;
const SVG_HEIGHT = (STEPS.length - 1) * NODE_SPACING + 40;

function nodeX(i: number) {
	return i % 2 === 0 ? 60 : 140;
}
function nodeY(i: number) {
	return 20 + i * NODE_SPACING;
}

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
			parts.push(`C ${prevX} ${midY}, ${x} ${midY}, ${x} ${y}`);
		}
	}
	return parts.join(" ");
}

const PATH_D = buildPath();
const ACCENT = "#FF5C26";

export function ScrollFlow() {
	const sectionRef = useRef<HTMLDivElement>(null);
	const pathRef = useRef<SVGPathElement>(null);
	const [progress, setProgress] = useState(0);
	const [pathLength, setPathLength] = useState(0);

	useEffect(() => {
		if (pathRef.current) {
			setPathLength(pathRef.current.getTotalLength());
		}
	}, []);

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

	const activeIndex = Math.min(Math.floor(progress * STEPS.length), STEPS.length - 1);
	const revealLength = pathLength * progress;
	const dashOffset = pathLength - revealLength;

	return (
		<section ref={sectionRef} id="flow" className="max-w-5xl mx-auto px-4 md:px-6 py-32 relative">
			{/* Header */}
			<div className="text-center mb-20 relative z-10">
				<div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border text-[10px] font-bold text-primary tracking-[0.2em] uppercase mb-6">
					<Route size={12} strokeWidth={2} />
					Request flow
				</div>
				<h2 className="text-4xl md:text-6xl font-extrabold text-on-surface tracking-[-0.035em] mb-4">
					See every step
				</h2>
				<p className="text-on-surface-variant text-lg max-w-xl mx-auto leading-relaxed">
					Scroll to trace a webhook from the moment it fires to the response your server sends back.
					Every hop, visualized.
				</p>
			</div>

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
					<path d={PATH_D} stroke="#1e1e22" strokeWidth="2" strokeLinecap="round" fill="none" />
					{/* Revealed path — single accent */}
					{pathLength > 0 && (
						<path
							d={PATH_D}
							stroke={ACCENT}
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

					{/* Node dots */}
					{STEPS.map((step, i) => {
						const isActive = i <= activeIndex;
						return (
							<g key={step.title}>
								{isActive && (
									<circle cx={nodeX(i)} cy={nodeY(i)} r="12" fill={ACCENT} opacity="0.18">
										<animate
											attributeName="r"
											values="10;16;10"
											dur="2s"
											repeatCount="indefinite"
										/>
									</circle>
								)}
								<circle
									cx={nodeX(i)}
									cy={nodeY(i)}
									r="6"
									fill={isActive ? ACCENT : "#0a0a0c"}
									stroke={isActive ? ACCENT : "#2a2a2f"}
									strokeWidth="2"
									style={{ transition: "all 0.5s ease" }}
								/>
							</g>
						);
					})}
				</svg>

				{/* Cards positioned alongside the path */}
				{STEPS.map((step, i) => {
					const isLeft = i % 2 === 0;
					const isActive = i <= activeIndex;
					const topPos = i * 240;
					const { Icon } = step;

					return (
						<div
							key={step.title}
							className={`absolute transition-all duration-700 w-[calc(50%-60px)] ${
								isActive ? "opacity-100 translate-y-0" : "opacity-30 translate-y-2"
							}`}
							style={{
								top: `${topPos}px`,
								...(isLeft ? { left: 0 } : { right: 0 }),
							}}
						>
							<div
								className={`bg-surface border rounded-xl p-7 transition-colors duration-500 ${
									isActive ? "border-border-strong" : "border-border-subtle"
								}`}
							>
								<div className="flex items-center gap-3 mb-4">
									<div
										className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors duration-500 ${
											isActive
												? "bg-primary-soft border border-primary/40"
												: "bg-surface-2 border border-border-subtle"
										}`}
									>
										<Icon
											size={18}
											strokeWidth={1.75}
											className={isActive ? "text-primary" : "text-on-surface-faint"}
										/>
									</div>
									<span className="text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.25em]">
										Step {i + 1}
									</span>
								</div>

								<h3 className="text-xl font-extrabold text-on-surface tracking-tight mb-2">
									{step.title}
								</h3>

								<p className="text-on-surface-variant text-[13px] leading-relaxed mb-4">
									{step.desc}
								</p>

								<div
									className={`font-mono text-[11px] px-3 py-2 rounded-lg transition-colors duration-500 ${
										isActive
											? "bg-primary-soft text-primary border border-primary/30"
											: "bg-surface-2 text-on-surface-faint border border-border-subtle"
									}`}
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
