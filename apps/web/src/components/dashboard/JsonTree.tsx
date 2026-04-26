import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

/**
 * Hand-rolled collapsible JSON viewer. Syntax-highlighted by type, every
 * object/array can be toggled open/closed. First level is open by default.
 *
 * Accepts either a raw string (attempts to parse) or an already-parsed value.
 * When parsing fails, renders the raw string as plain text.
 */
interface JsonTreeProps {
	value: unknown;
	/** Depth at which nodes start collapsed. Defaults to 1. */
	collapseAfter?: number;
	/** Render the outer padded container (default true). */
	withContainer?: boolean;
}

export function JsonTree({ value, collapseAfter = 1, withContainer = true }: JsonTreeProps) {
	// Accept raw strings: try to parse, else render as a text blob.
	let parsed: unknown = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value);
		} catch {
			const content = (
				<pre className="font-mono text-[11px] text-on-surface-variant overflow-x-auto whitespace-pre-wrap break-all">
					{value}
				</pre>
			);
			if (!withContainer) return content;
			return (
				<div className="bg-background border border-border-subtle rounded-md p-3 max-h-72 overflow-auto">
					{content}
				</div>
			);
		}
	}

	const tree = <Node value={parsed} depth={0} collapseAfter={collapseAfter} path="$" />;

	if (!withContainer) return tree;

	return (
		<div className="bg-background border border-border-subtle rounded-md p-3 font-mono text-[11.5px] leading-[1.7] max-h-72 overflow-auto">
			{tree}
		</div>
	);
}

function Node({
	value,
	depth,
	collapseAfter,
	path,
	keyName,
	trailingComma,
}: {
	value: unknown;
	depth: number;
	collapseAfter: number;
	path: string;
	keyName?: string;
	trailingComma?: boolean;
}) {
	const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
	const isArray = Array.isArray(value);

	if (isObject || isArray) {
		return (
			<ContainerNode
				value={value as Record<string, unknown> | unknown[]}
				depth={depth}
				collapseAfter={collapseAfter}
				path={path}
				keyName={keyName}
				trailingComma={trailingComma}
				isArray={isArray}
			/>
		);
	}

	return <LeafNode value={value} keyName={keyName} trailingComma={trailingComma} />;
}

function ContainerNode({
	value,
	depth,
	collapseAfter,
	path,
	keyName,
	trailingComma,
	isArray,
}: {
	value: Record<string, unknown> | unknown[];
	depth: number;
	collapseAfter: number;
	path: string;
	keyName?: string;
	trailingComma?: boolean;
	isArray: boolean;
}) {
	const [open, setOpen] = useState(depth < collapseAfter);
	const entries = isArray
		? (value as unknown[]).map((v, i) => [String(i), v] as const)
		: Object.entries(value as Record<string, unknown>);
	const openBracket = isArray ? "[" : "{";
	const closeBracket = isArray ? "]" : "}";
	const count = entries.length;
	const summary =
		count === 0 ? "" : ` ${count} ${isArray ? "item" : "key"}${count === 1 ? "" : "s"}`;

	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="inline-flex items-start gap-1 text-left hover:bg-surface rounded px-1 -ml-1"
				aria-expanded={open}
			>
				<span className="text-on-surface-muted pt-[2px]">
					{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
				</span>
				<span>
					{keyName !== undefined && <Key name={keyName} />}
					<span className="text-on-surface">{openBracket}</span>
					{!open && (
						<>
							<span className="text-on-surface-muted italic">{summary}</span>
							<span className="text-on-surface">{closeBracket}</span>
							{trailingComma && <span className="text-on-surface-muted">,</span>}
						</>
					)}
				</span>
			</button>
			{open && (
				<>
					<div className="ml-4 border-l border-border-subtle pl-3">
						{entries.map(([k, v], i) => (
							<Node
								key={k}
								value={v}
								depth={depth + 1}
								collapseAfter={collapseAfter}
								path={`${path}.${k}`}
								keyName={isArray ? undefined : k}
								trailingComma={i < entries.length - 1}
							/>
						))}
					</div>
					<div>
						<span className="text-on-surface">{closeBracket}</span>
						{trailingComma && <span className="text-on-surface-muted">,</span>}
					</div>
				</>
			)}
		</div>
	);
}

function LeafNode({
	value,
	keyName,
	trailingComma,
}: {
	value: unknown;
	keyName?: string;
	trailingComma?: boolean;
}) {
	return (
		<div>
			{keyName !== undefined && <Key name={keyName} />}
			<Value value={value} />
			{trailingComma && <span className="text-on-surface-muted">,</span>}
		</div>
	);
}

function Key({ name }: { name: string }) {
	return (
		<>
			<span className="text-primary-fixed">"{name}"</span>
			<span className="text-on-surface-muted">: </span>
		</>
	);
}

function Value({ value }: { value: unknown }) {
	if (value === null) return <span className="text-on-surface-muted">null</span>;
	if (typeof value === "boolean") return <span className="text-warning">{String(value)}</span>;
	if (typeof value === "number") return <span className="text-primary">{String(value)}</span>;
	if (typeof value === "string") return <span className="text-success">"{value}"</span>;
	return <span className="text-on-surface-variant">{String(value)}</span>;
}
