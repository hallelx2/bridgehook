import { CornerDownLeft, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface CommandAction {
	id: string;
	label: string;
	hint?: string;
	Icon?: LucideIcon;
	keywords?: string[];
	shortcut?: string;
	run: () => void | Promise<void>;
	disabled?: boolean;
}

interface CommandPaletteProps {
	actions: CommandAction[];
	open: boolean;
	onClose: () => void;
}

/**
 * Lightweight command palette. Parent registers a list of actions; the
 * palette handles open/close, fuzzy-ish filtering by keyword substring,
 * keyboard navigation (↑↓), and execution on Enter.
 */
export function CommandPalette({ actions, open, onClose }: CommandPaletteProps) {
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const filtered = useMemo(() => {
		const q = query.toLowerCase().trim();
		if (!q) return actions.filter((a) => !a.disabled);
		return actions.filter((a) => {
			if (a.disabled) return false;
			if (a.label.toLowerCase().includes(q)) return true;
			if (a.hint?.toLowerCase().includes(q)) return true;
			if (a.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
			return false;
		});
	}, [actions, query]);

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setActiveIndex(0);
		// Defer focus until DOM mounts
		requestAnimationFrame(() => inputRef.current?.focus());
	}, [open]);

	useEffect(() => {
		if (activeIndex >= filtered.length) setActiveIndex(0);
	}, [filtered.length, activeIndex]);

	useEffect(() => {
		if (!open) return;

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setActiveIndex((i) => Math.max(i - 1, 0));
			} else if (e.key === "Enter") {
				e.preventDefault();
				const target = filtered[activeIndex];
				if (target) {
					Promise.resolve(target.run()).finally(() => onClose());
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, filtered, activeIndex, onClose]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] bg-black/65 backdrop-blur-sm"
			onClick={onClose}
			onKeyDown={(e) => e.key === "Escape" && onClose()}
			// biome-ignore lint/a11y/useSemanticElements: native <dialog> requires imperative showModal()/close() that doesn't fit our React-driven open state
			role="dialog"
			aria-modal="true"
			aria-label="Command palette"
		>
			<div
				className="bg-surface border border-border-strong rounded-xl shadow-[0_40px_100px_-30px_rgba(0,0,0,0.8)] w-full max-w-xl mx-4 overflow-hidden"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="document"
			>
				<div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
					<Search size={14} strokeWidth={2} className="text-on-surface-muted shrink-0" />
					<input
						ref={inputRef}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search actions…"
						className="flex-1 bg-transparent text-on-surface placeholder-on-surface-faint focus:outline-none text-[14px]"
					/>
					<span className="text-[10px] font-bold text-on-surface-muted bg-surface-2 border border-border-subtle rounded px-1.5 py-0.5 uppercase tracking-wider">
						Esc
					</span>
				</div>

				<div className="max-h-[50vh] overflow-y-auto py-1">
					{filtered.length === 0 ? (
						<div className="px-4 py-6 text-center text-[12px] text-on-surface-muted">
							No matching actions
						</div>
					) : (
						filtered.map((action, i) => (
							<CommandRow
								key={action.id}
								action={action}
								active={i === activeIndex}
								onHover={() => setActiveIndex(i)}
								onClick={() => {
									Promise.resolve(action.run()).finally(() => onClose());
								}}
							/>
						))
					)}
				</div>

				<div className="flex items-center gap-3 px-4 py-2 border-t border-border-subtle bg-surface-muted text-[10px] text-on-surface-muted">
					<span className="inline-flex items-center gap-1">
						<kbd className="font-mono bg-surface-2 border border-border-subtle rounded px-1">
							↑↓
						</kbd>
						navigate
					</span>
					<span className="inline-flex items-center gap-1">
						<CornerDownLeft size={10} strokeWidth={2} />
						run
					</span>
				</div>
			</div>
		</div>
	);
}

function CommandRow({
	action,
	active,
	onHover,
	onClick,
}: {
	action: CommandAction;
	active: boolean;
	onHover: () => void;
	onClick: () => void;
}) {
	const { Icon } = action;
	return (
		<button
			type="button"
			onClick={onClick}
			onMouseEnter={onHover}
			className={`w-full text-left flex items-center gap-3 px-4 py-2.5 ${
				active ? "bg-primary-soft" : ""
			}`}
		>
			{Icon && (
				<Icon
					size={14}
					strokeWidth={2}
					className={active ? "text-primary" : "text-on-surface-muted"}
				/>
			)}
			<div className="flex-1 min-w-0">
				<div className={`text-[13px] ${active ? "text-on-surface" : "text-on-surface-variant"}`}>
					{action.label}
				</div>
				{action.hint && (
					<div className="text-[11px] text-on-surface-muted truncate">{action.hint}</div>
				)}
			</div>
			{action.shortcut && (
				<span className="font-mono text-[10px] text-on-surface-muted bg-surface-2 border border-border-subtle rounded px-1.5 py-0.5">
					{action.shortcut}
				</span>
			)}
		</button>
	);
}

/** Hook that opens/closes the palette on ⌘K / Ctrl+K. */
export function useCommandPaletteShortcut(onToggle: () => void) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				onToggle();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onToggle]);
}
