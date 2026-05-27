import { Link } from "react-router-dom";
import { Logo } from "./Logo";

const GITHUB_URL = "https://github.com/hallelx2/bridgehook";

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

				<div className="grid grid-cols-2 gap-12 md:gap-24">
					<div>
						<h4 className="text-on-surface font-bold text-xs uppercase tracking-[0.2em] mb-6">
							Product
						</h4>
						<ul className="space-y-3">
							<li>
								<Link
									to="/login"
									className="text-on-surface-variant hover:text-primary transition-colors text-sm font-medium no-underline"
								>
									Sign in
								</Link>
							</li>
							<li>
								<Link
									to="/login?signup=1"
									className="text-on-surface-variant hover:text-primary transition-colors text-sm font-medium no-underline"
								>
									Get started
								</Link>
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
									href={GITHUB_URL}
									target="_blank"
									rel="noopener noreferrer"
									className="text-on-surface-variant hover:text-primary transition-colors text-sm font-medium no-underline"
								>
									GitHub
								</a>
							</li>
							<li>
								<Link
									to="/privacy"
									className="text-on-surface-variant hover:text-primary transition-colors text-sm font-medium no-underline"
								>
									Privacy
								</Link>
							</li>
						</ul>
					</div>
				</div>
			</div>

			<div className="max-w-7xl mx-auto px-6 mt-20 pt-8 border-t border-border-subtle">
				<p className="text-on-surface-muted text-[10px] font-bold tracking-[0.3em] uppercase">
					&copy; 2026 BridgeHook. Built on Cloudflare Workers. Open source.
				</p>
			</div>
		</footer>
	);
}
