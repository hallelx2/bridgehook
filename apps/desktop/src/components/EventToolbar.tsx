import { useEffect, useRef } from "react";
import type { Service } from "../hooks/useServices";
import { cn } from "../lib/cn";

export interface EventFilter {
	search: string;
	method: string | null;
	statusClass: "all" | "2xx" | "3xx" | "4xx" | "5xx" | "err";
	serviceId: string | null;
}

interface EventToolbarProps {
	filter: EventFilter;
	onChange: (next: EventFilter) => void;
	services: Service[];
	totalEvents: number;
	visibleEvents: number;
	onClearEvents: () => void;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const STATUS_CLASSES: EventFilter["statusClass"][] = ["all", "2xx", "3xx", "4xx", "5xx", "err"];

export function EventToolbar({
	filter,
	onChange,
	services,
	totalEvents,
	visibleEvents,
	onClearEvents,
}: EventToolbarProps) {
	const searchRef = useRef<HTMLInputElement>(null);

	// `/` focuses search (Vim-style, common in devtools).
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLElement) {
				const tag = e.target.tagName;
				if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
			}
			if (e.key === "/") {
				e.preventDefault();
				searchRef.current?.focus();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	const set = <K extends keyof EventFilter>(key: K, value: EventFilter[K]) =>
		onChange({ ...filter, [key]: value });

	const active =
		filter.search.length > 0 ||
		filter.method != null ||
		filter.statusClass !== "all" ||
		filter.serviceId != null;

	return (
		<div className="px-3 h-9 border-b border-edge flex items-center gap-2 bg-ink-0 shrink-0">
			{/* Prompt + search */}
			<div className="relative flex items-center flex-1 max-w-md">
				<span className="absolute left-2 text-uranium text-caption font-bold pointer-events-none select-none">
					/
				</span>
				<input
					ref={searchRef}
					type="search"
					value={filter.search}
					onChange={(e) => set("search", e.target.value)}
					placeholder="filter events: paths, headers, bodies"
					className="w-full bg-transparent border border-edge rounded-sm pl-5 pr-2 h-7 text-caption text-fg placeholder-fg-ghost focus:outline-none focus:border-uranium/40 transition-colors"
					aria-label="Search events"
				/>
				{!filter.search && (
					<kbd className="absolute right-2 px-1 py-px text-micro rounded-sm border border-edge bg-ink-2 text-fg-faint pointer-events-none">
						/
					</kbd>
				)}
			</div>

			<div className="h-5 w-px bg-edge" />

			{/* Service select */}
			<Select
				label="svc"
				value={filter.serviceId ?? ""}
				onChange={(v) => set("serviceId", v || null)}
				options={[
					{ value: "", label: "·all" },
					...services.map((s) => ({ value: s.id, label: s.name })),
				]}
			/>

			{/* Method select */}
			<Select
				label="verb"
				value={filter.method ?? ""}
				onChange={(v) => set("method", v || null)}
				options={[{ value: "", label: "·any" }, ...METHODS.map((m) => ({ value: m, label: m }))]}
			/>

			<div className="h-5 w-px bg-edge mx-0.5" />

			{/* Status pills */}
			<div className="flex items-center gap-px">
				{STATUS_CLASSES.map((sc) => (
					<button
						key={sc}
						type="button"
						onClick={() => set("statusClass", sc)}
						className={cn(
							"px-1.5 h-6 text-micro tabular uppercase tracking-wider transition-colors first:rounded-l-sm last:rounded-r-sm border-y border-r first:border-l border-edge",
							filter.statusClass === sc
								? sc === "err"
									? "bg-err/10 text-err border-err/30"
									: "bg-uranium/10 text-uranium border-uranium/40"
								: "text-fg-faint hover:text-fg hover:bg-ink-3",
						)}
					>
						{sc}
					</button>
				))}
			</div>

			<div className="ml-auto flex items-center gap-2 text-micro tabular text-fg-faint uppercase tracking-widest">
				<span>
					<span className="text-fg">{visibleEvents}</span>
					{active && totalEvents !== visibleEvents && (
						<span>
							<span className="text-fg-ghost mx-0.5">/</span>
							{totalEvents}
						</span>
					)}
					<span className="ml-1 text-fg-ghost">events</span>
				</span>
				{active && (
					<button
						type="button"
						onClick={() =>
							onChange({ search: "", method: null, statusClass: "all", serviceId: null })
						}
						className="text-fg-faint hover:text-uranium transition-colors"
						title="Clear filters"
					>
						clear filters
					</button>
				)}
				{totalEvents > 0 && (
					<button
						type="button"
						onClick={onClearEvents}
						className="text-fg-faint hover:text-err transition-colors"
						title="Clear the event list (local only)"
					>
						clear list
					</button>
				)}
			</div>
		</div>
	);
}

function Select({
	label,
	value,
	onChange,
	options,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	options: { value: string; label: string }[];
}) {
	return (
		<label className="inline-flex items-center gap-1.5 text-micro text-fg-faint uppercase tracking-widest">
			<span className="text-fg-ghost">{label}</span>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="bg-ink-2 border border-edge rounded-sm px-1.5 h-6 text-caption text-fg-muted focus:outline-none focus:border-uranium/40 hover:text-fg cursor-pointer transition-colors normal-case tracking-normal"
			>
				{options.map((opt) => (
					<option key={opt.value} value={opt.value}>
						{opt.label}
					</option>
				))}
			</select>
		</label>
	);
}
