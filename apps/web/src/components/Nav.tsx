import { Logo } from "./Logo";

export function Nav() {
	return (
		<nav className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-6 nav-surface rounded-full px-5 py-2.5 text-sm">
			<a href="#" className="no-underline">
				<Logo size="sm" showIcon />
			</a>

			<div className="hidden md:flex items-center gap-6">
				<a
					href="#features"
					className="text-on-surface-variant font-medium hover:text-on-surface transition-colors"
				>
					Features
				</a>
				<a
					href="#flow"
					className="text-on-surface-variant font-medium hover:text-on-surface transition-colors"
				>
					How it works
				</a>
				<a
					href="#comparison"
					className="text-on-surface-variant font-medium hover:text-on-surface transition-colors"
				>
					Compare
				</a>
				<a
					href="#"
					className="text-on-surface-variant font-medium hover:text-on-surface transition-colors"
				>
					Docs
				</a>
			</div>

			<div className="flex items-center gap-4 border-l border-border pl-5 ml-1">
				<a
					href="https://github.com/hallelx2/bridgehook"
					target="_blank"
					rel="noopener noreferrer"
					className="text-on-surface-variant hover:text-on-surface transition-colors text-sm font-semibold no-underline"
				>
					GitHub
				</a>
				<a
					href="#/dashboard"
					className="bg-on-surface text-background px-4 py-1.5 rounded-full font-semibold transition-colors hover:bg-primary hover:text-on-surface no-underline text-sm"
				>
					Open app
				</a>
			</div>
		</nav>
	);
}
