import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";

export interface Command {
	id: string;
	title: string;
	hint?: string;
	run: () => void | Promise<void>;
}

interface CommandPaletteProps {
	commands: Command[];
}

/**
 * Cmd+K / Ctrl+K command palette. Fuzzy filters by substring.
 */
export function CommandPalette({ commands }: CommandPaletteProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIdx, setActiveIdx] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const isMeta = e.metaKey || e.ctrlKey;
			if (isMeta && (e.key === "k" || e.key === "K")) {
				e.preventDefault();
				setOpen((v) => !v);
				return;
			}
			if (e.key === "Escape" && open) {
				e.preventDefault();
				setOpen(false);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open]);

	useEffect(() => {
		if (open) {
			setQuery("");
			setActiveIdx(0);
			setTimeout(() => inputRef.current?.focus(), 0);
		}
	}, [open]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return commands;
		return commands.filter((c) => {
			const hay = `${c.title} ${c.hint ?? ""}`.toLowerCase();
			return q.split(/\s+/).every((token) => hay.includes(token));
		});
	}, [query, commands]);

	useEffect(() => {
		if (activeIdx >= filtered.length) setActiveIdx(Math.max(0, filtered.length - 1));
	}, [filtered, activeIdx]);

	if (!open) return null;

	const execute = async (cmd: Command | undefined) => {
		if (!cmd) return;
		setOpen(false);
		try {
			await cmd.run();
		} catch (err) {
			console.error("Command failed:", err);
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[18vh] animate-fade-in-up"
			onClick={() => setOpen(false)}
			onKeyDown={(e) => {
				if (e.key === "Escape") setOpen(false);
			}}
			// biome-ignore lint/a11y/useSemanticElements: custom modal, not native <dialog>
			role="dialog"
			aria-modal="true"
			aria-label="Command palette"
		>
			<div
				className="w-[min(560px,92vw)] glass border border-edge-strong rounded-sm shadow-modal overflow-hidden font-sans"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="presentation"
			>
				{/* Prompt bar */}
				<div className="flex items-center gap-2 px-3 h-11 border-b border-edge bg-ink-2/60">
					<span className="text-uranium font-bold text-ui select-none animate-caret-blink">▍</span>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "ArrowDown") {
								e.preventDefault();
								setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
							} else if (e.key === "ArrowUp") {
								e.preventDefault();
								setActiveIdx((i) => Math.max(0, i - 1));
							} else if (e.key === "Enter") {
								e.preventDefault();
								execute(filtered[activeIdx]);
							}
						}}
						placeholder="run command, search service, type / for help…"
						className="flex-1 bg-transparent text-ui text-fg placeholder-fg-ghost focus:outline-none tracking-tight"
					/>
					<kbd className="px-1.5 py-px text-micro rounded-sm border border-edge bg-ink-2 text-fg-faint shrink-0">
						esc
					</kbd>
				</div>
				{/* Results */}
				<div className="max-h-[48vh] overflow-y-auto py-1">
					{filtered.length === 0 ? (
						<div className="px-4 py-6 text-caption text-fg-faint text-center tabular">
							<div className="text-fg-ghost mb-1">∅</div>
							no commands match <span className="text-fg-muted">"{query}"</span>
						</div>
					) : (
						filtered.map((cmd, i) => {
							const active = activeIdx === i;
							return (
								<button
									key={cmd.id}
									type="button"
									onClick={() => execute(cmd)}
									onMouseEnter={() => setActiveIdx(i)}
									className={cn(
										"w-full flex items-center justify-between gap-3 px-3 h-8 text-caption text-left transition-colors",
										active
											? "bg-uranium/10 text-fg rule-accent"
											: "text-fg-muted hover:bg-ink-3/50",
									)}
								>
									<span className="flex items-center gap-2 min-w-0">
										<span className={cn("text-micro", active ? "text-uranium" : "text-fg-ghost")}>
											{active ? "→" : "·"}
										</span>
										<span className="truncate tabular tracking-tight">{cmd.title}</span>
									</span>
									{cmd.hint && (
										<kbd className="px-1.5 py-px text-micro rounded-sm border border-edge bg-ink-2/60 text-fg-faint normal-case shrink-0">
											{cmd.hint}
										</kbd>
									)}
								</button>
							);
						})
					)}
				</div>
				{/* Footer hint strip */}
				<div className="flex items-center gap-3 px-3 h-7 border-t border-edge bg-ink-2/40 text-micro text-fg-ghost uppercase tracking-widest tabular">
					<span className="flex items-center gap-1">
						<kbd className="text-fg-faint normal-case tracking-normal">↑↓</kbd>
						<span>navigate</span>
					</span>
					<span className="flex items-center gap-1">
						<kbd className="text-fg-faint normal-case tracking-normal">⏎</kbd>
						<span>run</span>
					</span>
					<span className="ml-auto text-fg-faint tabular tracking-normal normal-case">
						{filtered.length} cmd{filtered.length === 1 ? "" : "s"}
					</span>
				</div>
			</div>
		</div>
	);
}
