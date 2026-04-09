export function FinalCTA() {
	return (
		<section className="max-w-7xl mx-auto px-8 pb-48">
			<div className="relative moving-border-card rounded-[4rem]">
				<div className="moving-border-content p-24 md:p-40 text-center border border-white/10 rounded-[4rem]">
					<h2 className="text-6xl md:text-9xl font-black text-white mb-12 tracking-[-0.05em] leading-none font-headline">
						Ready to debug
						<br />
						faster?
					</h2>
					<p className="max-w-2xl mx-auto text-zinc-400 text-xl mb-14 font-medium">
						Ditch complex tunnels for BridgeHook's instant
						browser-based webhook endpoints. Zero install, zero
						config.
					</p>
					<div className="flex flex-col sm:flex-row justify-center gap-6">
						<button
							type="button"
							className="px-16 py-7 bg-white text-black font-black rounded-3xl hover:scale-110 transition-all duration-500 active:scale-95 text-xl"
						>
							GET STARTED FREE
						</button>
						<button
							type="button"
							className="px-16 py-7 bg-[#18181b] text-white border border-white/20 font-black rounded-3xl hover:bg-[#27272a] transition-all text-xl"
						>
							VIEW DEMO
						</button>
					</div>
				</div>
			</div>
		</section>
	);
}
