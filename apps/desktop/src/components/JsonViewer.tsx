import { useMemo, useState } from "react";
import { cn } from "../lib/cn";

interface JsonViewerProps {
	value: string | null | undefined;
	maxHeight?: number;
	emptyLabel?: string;
	className?: string;
}

/**
 * Lightweight JSON viewer with syntax coloring and collapse.
 * Unlike the previous regex-based implementation, this walks a parsed
 * AST so nested/escaped values are handled correctly.
 */
export function JsonViewer({
	value,
	maxHeight = 220,
	emptyLabel = "(empty)",
	className,
}: JsonViewerProps) {
	const parsed = useMemo(() => {
		if (!value) return { kind: "empty" as const };
		try {
			return { kind: "json" as const, node: JSON.parse(value) as unknown };
		} catch {
			return { kind: "raw" as const, text: value };
		}
	}, [value]);

	if (parsed.kind === "empty") {
		return <span className="text-fg-ghost italic text-caption">{emptyLabel}</span>;
	}

	if (parsed.kind === "raw") {
		return (
			<pre
				className={cn(
					"bg-ink-0 rounded-sm p-2.5 text-caption whitespace-pre-wrap text-fg-muted border border-edge tabular leading-snug",
					className,
				)}
				style={{ maxHeight, overflow: "auto" }}
			>
				{parsed.text}
			</pre>
		);
	}

	return (
		<div
			className={cn(
				"bg-ink-0 rounded-sm p-2.5 text-caption border border-edge overflow-auto tabular leading-snug",
				className,
			)}
			style={{ maxHeight }}
		>
			<Node value={parsed.node} depth={0} path="$" />
		</div>
	);
}

function Node({ value, depth, path }: { value: unknown; depth: number; path: string }) {
	if (value === null) return <span className="text-warn">null</span>;
	if (value === undefined) return <span className="text-fg-ghost">undefined</span>;
	if (typeof value === "boolean") return <span className="text-warn">{String(value)}</span>;
	if (typeof value === "number") return <span className="text-method-put">{value}</span>;
	if (typeof value === "string")
		return <span className="text-method-post">{JSON.stringify(value)}</span>;

	if (Array.isArray(value)) {
		return <ArrayNode value={value} depth={depth} path={path} />;
	}
	if (typeof value === "object") {
		return <ObjectNode value={value as Record<string, unknown>} depth={depth} path={path} />;
	}
	return <span>{String(value)}</span>;
}

function Collapsible({
	preview,
	depth,
	children,
	defaultOpen,
}: {
	preview: string;
	depth: number;
	children: React.ReactNode;
	defaultOpen: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<span>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="text-fg-ghost hover:text-uranium select-none transition-colors"
				aria-expanded={open}
			>
				{open ? "▾" : "▸"}
			</button>
			{open ? (
				<span style={{ marginLeft: depth === 0 ? 0 : 8 }}>{children}</span>
			) : (
				<span className="text-fg-ghost ml-1">{preview}</span>
			)}
		</span>
	);
}

function ObjectNode({
	value,
	depth,
	path,
}: {
	value: Record<string, unknown>;
	depth: number;
	path: string;
}) {
	const keys = Object.keys(value);
	if (keys.length === 0) return <span className="text-fg-ghost">{"{}"}</span>;
	const preview = `{…${keys.length}}`;
	return (
		<Collapsible preview={preview} depth={depth} defaultOpen={depth < 2}>
			<span className="text-fg-ghost">{"{"}</span>
			<div style={{ paddingLeft: 12 }}>
				{keys.map((k, i) => (
					<div key={`${path}.${k}`}>
						<span className="text-uranium/80">{JSON.stringify(k)}</span>
						<span className="text-fg-ghost">: </span>
						<Node value={value[k]} depth={depth + 1} path={`${path}.${k}`} />
						{i < keys.length - 1 && <span className="text-fg-ghost">,</span>}
					</div>
				))}
			</div>
			<span className="text-fg-ghost">{"}"}</span>
		</Collapsible>
	);
}

function ArrayNode({ value, depth, path }: { value: unknown[]; depth: number; path: string }) {
	if (value.length === 0) return <span className="text-fg-ghost">[]</span>;
	const preview = `[…${value.length}]`;
	return (
		<Collapsible preview={preview} depth={depth} defaultOpen={depth < 2}>
			<span className="text-fg-ghost">[</span>
			<div style={{ paddingLeft: 12 }}>
				{value.map((v, i) => (
					<div key={`${path}[${i}]`}>
						<Node value={v} depth={depth + 1} path={`${path}[${i}]`} />
						{i < value.length - 1 && <span className="text-fg-ghost">,</span>}
					</div>
				))}
			</div>
			<span className="text-fg-ghost">]</span>
		</Collapsible>
	);
}
