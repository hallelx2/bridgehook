import { Logo } from "./Logo";

export function Footer() {
	return (
		<footer className="bg-background py-24 border-t border-border-subtle">
			<div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start px-6">
				<div className="mb-12 md:mb-0">
					<Logo size="lg" />
					<p className="text-on-surface-muted mt-4 text-xs font-bold tracking-[0.2em] uppercase">
						Zero-install webhook testing.
					</p>
				</div>

				<div className="grid grid-cols-2 md:grid-cols-3 gap-12 md:gap-24">
					<div>
						<h4 className="text-on-surface font-bold text-xs uppercase tracking-[0.2em] mb-6">
							Platform
						</h4>
						<ul className="space-y-3">
							<li>
								<a
									href="#"
									className="text-on-surface-variant hover:text-primary transition-colors text-sm font-medium no-underline"
								>
									Web app
								</a>
							</li>
							<li>
								<a
									href="#"
									className="text-on-surface-variant hover:text-primary transition-colors text-sm font-medium no-underline"
								>
									Desktop app
								</a>
							</li>
							<li>
								<a
									href="#"
									className="text-on-surface-variant hover:text-primary transition-colors text-sm font-medium no-underline"
								>
									Relay API
								</a>
							</li>
						</ul>
					</div>
					<div>
						<h4 className="text-on-surface font-bold text-xs uppercase tracking-[0.2em] mb-6">
							Resources
						</h4>
						<ul className="space-y-3">
							<li>
								<a
									href="#"
									className="text-on-surface-variant hover:text-primary transition-colors text-sm font-medium no-underline"
								>
									Documentation
								</a>
							</li>
							<li>
								<a
									href="#"
									className="text-on-surface-variant hover:text-primary transition-colors text-sm font-medium no-underline"
								>
									GitHub
								</a>
							</li>
							<li>
								<a
									href="#"
									className="text-on-surface-variant hover:text-primary transition-colors text-sm font-medium no-underline"
								>
									Status
								</a>
							</li>
						</ul>
					</div>
					<div>
						<h4 className="text-on-surface font-bold text-xs uppercase tracking-[0.2em] mb-6">
							Company
						</h4>
						<ul className="space-y-3">
							<li>
								<a
									href="#"
									className="text-on-surface-variant hover:text-primary transition-colors text-sm font-medium no-underline"
								>
									About
								</a>
							</li>
							<li>
								<a
									href="#"
									className="text-on-surface-variant hover:text-primary transition-colors text-sm font-medium no-underline"
								>
									Blog
								</a>
							</li>
						</ul>
					</div>
				</div>
			</div>

			<div className="max-w-7xl mx-auto px-6 mt-20 pt-8 border-t border-border-subtle">
				<p className="text-on-surface-muted text-[10px] font-bold tracking-[0.3em] uppercase">
					&copy; 2025 BridgeHook. Built on Cloudflare Workers. Free &amp; open source.
				</p>
			</div>
		</footer>
	);
}
