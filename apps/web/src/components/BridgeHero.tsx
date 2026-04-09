/**
 * Axiom-style staircase bars — vertical gradient bars tiling across the viewport.
 * Heights form a valley/bridge curve: tall on edges, short in center, tall again.
 * Colors shift across a spectrum: deep indigo → purple → violet → pink → blush.
 * Each bar has a vertical gradient that's vivid at the bottom and fades to
 * transparent at the top, like the Axiom hero but oriented vertically.
 */
const BAR_COUNT = 15;

function generateBars() {
	const bars = [];
	const mid = (BAR_COUNT - 1) / 2;

	for (let i = 0; i < BAR_COUNT; i++) {
		const distFromCenter = Math.abs(i - mid) / mid;
		// Valley: tall edges (95vh), short center (30vh)
		const minH = 30;
		const maxH = 95;
		const height = minH + (maxH - minH) * (distFromCenter ** 0.7);
		// Animation: center bars arrive last
		const delay = (1 - distFromCenter) * 2.5;

		bars.push({
			left: `${(i / BAR_COUNT) * 100}%`,
			width: `${100 / BAR_COUNT + 0.1}%`, // tiny overlap to prevent subpixel gaps
			height: `${height}vh`,
			delay: `${delay.toFixed(1)}s`,
		});
	}
	return bars;
}

const BARS = generateBars();

export function BridgeHero() {
	return (
		<section className="min-h-screen flex flex-col items-center justify-center relative pt-24 overflow-hidden">
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

			{/* Dark overlay in center where text sits — keeps text readable */}
			<div className="absolute inset-0 -z-[5] bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(3,3,3,0.9)_0%,transparent_100%)] pointer-events-none" />

			<div className="max-w-7xl mx-auto px-8 text-center relative z-10 py-20">
				{/* Badge */}
				<div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 backdrop-blur-md border border-white/10 text-[10px] font-bold text-primary-fixed tracking-[0.2em] uppercase mb-12 animate-float font-label">
					<span className="w-1 h-1 rounded-full bg-primary shadow-[0_0_8px_#9093ff]" />
					Zero-install webhook testing
				</div>

				{/* Headline */}
				<h1 className="text-6xl md:text-8xl lg:text-9xl font-extrabold tracking-[-0.04em] mb-10 leading-[0.85] text-white font-headline">
					Test webhooks
					<br />
					<span className="bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-white/30">
						from your browser.
					</span>
				</h1>

				{/* Subtitle */}
				<p className="max-w-xl mx-auto text-zinc-400 text-lg md:text-xl leading-relaxed mb-14 font-medium tracking-tight font-body">
					No tunnels. No CLI. No binaries. Capture, inspect, and replay
					HTTP requests in real-time.
				</p>

				{/* CTAs */}
				<div className="flex flex-col sm:flex-row items-center justify-center gap-6">
					<a
						href="#/dashboard"
						className="w-full sm:w-auto px-12 py-5 bg-white text-black font-black rounded-2xl shadow-[0_0_40px_rgba(255,255,255,0.15)] transition-all hover:scale-105 active:scale-95 font-headline no-underline text-center"
					>
						Start Testing Free
					</a>
					<a
						href="#flow"
						className="w-full sm:w-auto px-12 py-5 bg-[#18181b] text-white border border-white/20 font-bold rounded-2xl hover:bg-[#27272a] transition-all font-body no-underline text-center"
					>
						View Demo
					</a>
				</div>
			</div>

			{/* Bottom fade */}
			<div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-background to-transparent z-10" />
		</section>
	);
}
