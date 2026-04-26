import { Search, X } from "lucide-react";
import type { LiveEvent } from "../../hooks/useBridge";

export type StatusFilter = "all" | "success" | "client-error" | "server-error" | "pending";
export type MethodFilter = "all" | "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Filters {
	query: string;
	status: StatusFilter;
	method: MethodFilter;
}

export const DEFAULT_FILTERS: Filters = {
	query: "",
	status: "all",
	method: "all",
};

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "success", label: "2xx" },
	{ value: "client-error", label: "4xx" },
	{ value: "server-error", label: "5xx" },
	{ value: "pending", label: "Pending" },
];

const METHOD_OPTIONS: MethodFilter[] = ["all", "GET", "POST", "PUT", "PATCH", "DELETE"];

interface FilterBarProps {
	filters: Filters;
	onChange: (next: Filters) => void;
	totalCount: number;
	matchedCount: number;
	queryInputRef?: React.RefObject<HTMLInputElement | null>;
}

export function FilterBar({
	filters,
	onChange,
	totalCount,
	matchedCount,
	queryInputRef,
}: FilterBarProps) {
	const isFiltering =
		filters.query.length > 0 || filters.status !== "all" || filters.method !== "all";

	return (
		<div className="flex items-center gap-3 px-5 py-2.5 border-b border-border-subtle bg-surface-muted">
			{/* Search */}
			<div className="relative flex-1 max-w-md">
				<Search
					size={12}
					strokeWidth={2}
					className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-muted"
				/>
				<input
					ref={queryInputRef}
					type="text"
					value={filters.query}
					onChange={(e) => onChange({ ...filters, query: e.target.value })}
					placeholder="Filter by path or body…"
					className="w-full bg-background border border-border-subtle rounded-md pl-7 pr-7 py-1.5 font-mono text-[12px] text-on-surface placeholder-on-surface-faint focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
				/>
				{filters.query && (
					<button
						type="button"
						onClick={() => onChange({ ...filters, query: "" })}
						aria-label="Clear search"
						className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-muted hover:text-on-surface transition-colors"
					>
						<X size={12} strokeWidth={2} />
					</button>
				)}
			</div>

			{/* Status pills */}
			<div className="flex items-center gap-1">
				{STATUS_OPTIONS.map((opt) => (
					<button
						type="button"
						key={opt.value}
						onClick={() => onChange({ ...filters, status: opt.value })}
						className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider transition-colors ${
							filters.status === opt.value
								? "bg-primary-soft text-primary border border-primary/30"
								: "text-on-surface-muted border border-border-subtle hover:text-on-surface"
						}`}
					>
						{opt.label}
					</button>
				))}
			</div>

			{/* Method dropdown */}
			<select
				value={filters.method}
				onChange={(e) => onChange({ ...filters, method: e.target.value as MethodFilter })}
				className="bg-background border border-border-subtle rounded-md px-2 py-1 text-[11px] font-bold text-on-surface focus:outline-none focus:border-primary/40"
			>
				{METHOD_OPTIONS.map((m) => (
					<option key={m} value={m}>
						{m === "all" ? "All methods" : m}
					</option>
				))}
			</select>

			{/* Count */}
			<span className="text-[10.5px] text-on-surface-muted whitespace-nowrap">
				{isFiltering ? (
					<>
						<span className="text-on-surface font-bold">{matchedCount}</span> of{" "}
						<span className="font-bold">{totalCount}</span>
					</>
				) : (
					<>
						<span className="text-on-surface font-bold">{totalCount}</span> events
					</>
				)}
			</span>
		</div>
	);
}

/** Apply filters to an event list. Pure — safe for memoization. */
export function applyFilters(events: LiveEvent[], filters: Filters): LiveEvent[] {
	const q = filters.query.toLowerCase().trim();
	return events.filter((e) => {
		// Method filter
		if (filters.method !== "all" && e.method.toUpperCase() !== filters.method) return false;

		// Status filter
		if (filters.status !== "all") {
			const s = e.responseStatus;
			if (filters.status === "pending" && (s !== null || e.error)) return false;
			if (filters.status === "success" && !(s !== null && s >= 200 && s < 300)) return false;
			if (filters.status === "client-error" && !(s !== null && s >= 400 && s < 500)) return false;
			if (filters.status === "server-error" && !(s !== null && s >= 500)) return false;
		}

		// Query filter — match path or body substring
		if (q) {
			const inPath = e.path.toLowerCase().includes(q);
			const inBody = (e.requestBody ?? "").toLowerCase().includes(q);
			if (!inPath && !inBody) return false;
		}

		return true;
	});
}
