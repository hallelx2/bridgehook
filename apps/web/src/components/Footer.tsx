import { Logo } from "./Logo";

export function Footer() {
	return (
		<footer className="bg-black py-32 border-t border-white/5">
			<div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start px-8">
				<div className="mb-16 md:mb-0">
					<Logo size="lg" />
					<p className="text-zinc-600 mt-6 text-sm font-bold tracking-[0.2em] uppercase font-label">
						Zero-install webhook testing.
					</p>
				</div>

				<div className="grid grid-cols-2 md:grid-cols-3 gap-16 md:gap-32 font-body">
					<div>
						<h4 className="text-white font-black text-xs uppercase tracking-[0.2em] mb-8 font-headline">
							Platform
						</h4>
						<ul className="space-y-4">
							<li>
								<a
									href="#"
									className="text-zinc-400 hover:text-primary transition-colors text-sm font-medium"
								>
									Web App
								</a>
							</li>
							<li>
								<a
									href="#"
									className="text-zinc-400 hover:text-primary transition-colors text-sm font-medium"
								>
									Desktop App
								</a>
							</li>
							<li>
								<a
									href="#"
									className="text-zinc-400 hover:text-primary transition-colors text-sm font-medium"
								>
									Relay API
								</a>
							</li>
						</ul>
					</div>
					<div>
						<h4 className="text-white font-black text-xs uppercase tracking-[0.2em] mb-8 font-headline">
							Resources
						</h4>
						<ul className="space-y-4">
							<li>
								<a
									href="#"
									className="text-zinc-400 hover:text-primary transition-colors text-sm font-medium"
								>
									Documentation
								</a>
							</li>
							<li>
								<a
									href="#"
									className="text-zinc-400 hover:text-primary transition-colors text-sm font-medium"
								>
									GitHub
								</a>
							</li>
							<li>
								<a
									href="#"
									className="text-zinc-400 hover:text-primary transition-colors text-sm font-medium"
								>
									Status
								</a>
							</li>
						</ul>
					</div>
					<div>
						<h4 className="text-white font-black text-xs uppercase tracking-[0.2em] mb-8 font-headline">
							Company
						</h4>
						<ul className="space-y-4">
							<li>
								<a
									href="#"
									className="text-zinc-400 hover:text-primary transition-colors text-sm font-medium"
								>
									About
								</a>
							</li>
							<li>
								<a
									href="#"
									className="text-zinc-400 hover:text-primary transition-colors text-sm font-medium"
								>
									Blog
								</a>
							</li>
						</ul>
					</div>
				</div>
			</div>

			<div className="max-w-7xl mx-auto px-8 mt-32 pt-12 border-t border-white/5">
				<p className="text-zinc-600 text-[10px] font-bold tracking-[0.4em] uppercase font-label">
					&copy; 2025 BridgeHook. Built on Cloudflare Workers. Free &amp; open source.
				</p>
			</div>
		</footer>
	);
}
