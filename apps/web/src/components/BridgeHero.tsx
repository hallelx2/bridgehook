import { HeroLiveDemo } from "./HeroLiveDemo";

/**
 * Hero: telescoping gradient pillars that form a valley across the viewport.
 * Heights are tall on edges, short in the center — like looking through a
 * bridge. Colors are a single warm-orange spectrum, intentionally muted.
 * Text sits in a dimmed center ellipse for legibility over the bars.
 */
const BAR_COUNT = 15;

function generateBars() {
	const bars = [];
	const mid = (BAR_COUNT - 1) / 2;

	for (let i = 0; i < BAR_COUNT; i++) {
		const distFromCenter = Math.abs(i - mid) / mid;
		const minH = 30;
		const maxH = 95;
		const height = minH + (maxH - minH) * distFromCenter ** 0.7;
		const delay = (1 - distFromCenter) * 2.5;

		bars.push({
			left: `${(i / BAR_COUNT) * 100}%`,
			width: `${100 / BAR_COUNT + 0.1}%`,
			height: `${height}vh`,
			delay: `${delay.toFixed(1)}s`,
		});
	}
	return bars;
}

const BARS = generateBars();

export function BridgeHero() {
	return (
		<section className="min-h-screen flex flex-col items-center justify-start relative pt-28 overflow-hidden">
			{/* Bars */}
			<div className="absolute inset-0 -z-10 overflow-hidden">
				{BARS.map((bar, i) => (
					<div
						key={i}
						className="telescope-pillar animate-telescope"
						style={{
							left: bar.left,
							width: bar.width,
							height: bar.height,
							animationDelay: bar.delay,
						}}
					/>
				))}
			</div>

			{/* Center legibility ellipse — keeps text readable over bars */}
			<div className="absolute inset-0 -z-[5] bg-[radial-gradient(ellipse_60%_50%_at_50%_45%,rgba(3,3,3,0.92)_0%,transparent_100%)] pointer-events-none" />

			<div className="max-w-6xl mx-auto px-6 text-center relative z-10 pt-16 pb-8">
				{/* Badge */}
				<div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border text-[10px] font-bold text-primary-fixed tracking-[0.2em] uppercase mb-10">
					<span className="w-1.5 h-1.5 rounded-full bg-primary" />
					Zero-install webhook testing
				</div>

				{/* Headline — tight, oversized, no gradient text */}
				<h1 className="text-6xl md:text-8xl lg:text-[9.5rem] font-extrabold tracking-[-0.045em] mb-8 leading-[0.88] text-on-surface">
					Test webhooks
					<br />
					<span className="text-on-surface-variant">from your browser.</span>
				</h1>

				{/* Subtitle */}
				<p className="max-w-xl mx-auto text-on-surface-variant text-lg md:text-xl leading-relaxed mb-10 tracking-tight">
					No tunnels. No CLI. No binaries. Capture, inspect, and replay HTTP requests in real time.
				</p>

				{/* CTAs */}
				<div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-16">
					<a
						href="#/dashboard"
						className="w-full sm:w-auto px-8 py-4 bg-on-surface text-background font-bold rounded-xl transition-all hover:bg-primary hover:text-on-surface active:scale-[0.98] no-underline text-center text-[15px]"
					>
						Open dashboard
					</a>
					<a
						href="#try"
						className="w-full sm:w-auto px-8 py-4 bg-transparent text-on-surface border border-border-strong font-semibold rounded-xl hover:bg-surface transition-all no-underline text-center text-[15px]"
					>
						Try it live ↓
					</a>
				</div>
			</div>

			{/* Live demo card sits directly under the CTAs, still within the hero */}
			<HeroLiveDemo />

			{/* Bottom fade */}
			<div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-background to-transparent z-0 pointer-events-none" />
		</section>
	);
}
