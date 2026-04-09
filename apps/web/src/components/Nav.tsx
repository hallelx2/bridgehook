import { Logo } from "./Logo";

export function Nav() {
	return (
		<nav className="fixed top-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-8 glass-nav rounded-full px-8 py-3 shadow-2xl tracking-tight text-sm font-medium">
			<a href="#" className="no-underline">
				<Logo size="sm" showIcon />
			</a>

			<div className="hidden md:flex items-center gap-8 font-body">
				<a
					href="#features"
					className="text-neutral-400 font-semibold hover:text-white transition-all"
				>
					Features
				</a>
				<a href="#flow" className="text-neutral-400 hover:text-white transition-all">
					How it works
				</a>
				<a href="#comparison" className="text-neutral-400 hover:text-white transition-all">
					Compare
				</a>
				<a href="#" className="text-neutral-400 hover:text-white transition-all">
					Docs
				</a>
			</div>

			<div className="flex items-center gap-6 border-l border-white/10 pl-8 ml-2">
				<button
					type="button"
					className="text-neutral-400 hover:text-white transition-all text-sm font-bold font-body"
				>
					GitHub
				</button>
				<a
					href="#/dashboard"
					className="bg-white text-black px-6 py-2 rounded-full font-bold transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.2)] font-headline no-underline"
				>
					Get Started
				</a>
			</div>
		</nav>
	);
}
