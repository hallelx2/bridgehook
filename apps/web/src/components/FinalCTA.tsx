export function FinalCTA() {
	return (
		<section className="max-w-7xl mx-auto px-6 pb-48">
			<div className="bg-surface border border-border rounded-[2.5rem] p-16 md:p-32 text-center relative overflow-hidden">
				{/* Subtle grid texture — replaces glow */}
				<div className="absolute inset-0 grid-overlay opacity-40 pointer-events-none" />
				{/* Accent strip on top */}
				<div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />

				<div className="relative">
					<h2 className="text-5xl md:text-8xl font-extrabold text-on-surface mb-10 tracking-[-0.045em] leading-[0.9]">
						Ready to debug
						<br />
						<span className="text-on-surface-variant">faster?</span>
					</h2>
					<p className="max-w-xl mx-auto text-on-surface-variant text-lg mb-10">
						Ditch complex tunnels for BridgeHook's instant browser-based webhook endpoints. Zero
						install, zero config.
					</p>
					<div className="flex flex-col sm:flex-row justify-center gap-3">
						<a
							href="#/dashboard"
							className="px-8 py-4 bg-on-surface text-background font-bold rounded-xl hover:bg-primary hover:text-on-surface transition-colors text-[15px] no-underline"
						>
							Get started free
						</a>
						<a
							href="#try"
							className="px-8 py-4 bg-transparent text-on-surface border border-border-strong font-semibold rounded-xl hover:bg-surface-2 transition-colors text-[15px] no-underline"
						>
							View demo
						</a>
					</div>
				</div>
			</div>
		</section>
	);
}
