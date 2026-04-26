import { Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LiveEvent } from "../../hooks/useBridge";
import { prettyJson } from "../../lib/format";

interface ReplayEditorProps {
	event: LiveEvent | null;
	onClose: () => void;
	onSubmit: (edits: { body?: string; headers?: Record<string, string> }) => Promise<void>;
}

/**
 * Modal that lets the user tweak a request's body and headers before
 * re-firing it. The fired request flows through normal polling, so the
 * replay shows up as a new row in the feed.
 *
 * Body is edited as JSON when possible (pretty-printed), as raw text
 * otherwise. Headers are edited as one-key-per-line `key: value` pairs.
 */
export function ReplayEditor({ event, onClose, onSubmit }: ReplayEditorProps) {
	const [body, setBody] = useState("");
	const [headersText, setHeadersText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	// Reset fields whenever the target event changes
	useEffect(() => {
		if (!event) return;
		setBody(prettyJson(event.requestBody) || event.requestBody || "");
		const lines = Object.entries(event.requestHeaders).map(([k, v]) => `${k}: ${v}`);
		setHeadersText(lines.join("\n"));
		setError(null);
	}, [event]);

	useEffect(() => {
		if (!event) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [event, onClose]);

	if (!event) return null;

	const parseHeaders = (text: string): Record<string, string> | { error: string } => {
		const out: Record<string, string> = {};
		const lines = text.split("\n");
		for (const raw of lines) {
			const line = raw.trim();
			if (!line) continue;
			const idx = line.indexOf(":");
			if (idx === -1) return { error: `Header missing ":" → ${line.slice(0, 40)}` };
			const k = line.slice(0, idx).trim();
			const v = line.slice(idx + 1).trim();
			if (!k) return { error: `Empty header name → ${line.slice(0, 40)}` };
			out[k] = v;
		}
		return out;
	};

	const handleSubmit = async () => {
		const result = parseHeaders(headersText);
		if ("error" in result) {
			setError(result.error);
			return;
		}
		setError(null);
		setSubmitting(true);
		try {
			await onSubmit({ body, headers: result });
			onClose();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
			onClick={onClose}
			onKeyDown={(e) => e.key === "Escape" && onClose()}
			// biome-ignore lint/a11y/useSemanticElements: native <dialog> requires imperative showModal()/close() that doesn't fit our React-driven open state
			role="dialog"
			aria-modal="true"
			aria-label="Edit and replay event"
		>
			<div
				className="bg-surface border border-border-strong rounded-xl shadow-[0_40px_100px_-30px_rgba(0,0,0,0.8)] w-full max-w-3xl max-h-[85vh] flex flex-col mx-4"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="document"
			>
				{/* Header */}
				<div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle bg-surface-muted">
					<div>
						<div className="text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-0.5">
							Edit & replay
						</div>
						<div className="font-mono text-[12px] text-on-surface">
							<span className="text-success font-bold">{event.method}</span>{" "}
							<span className="text-on-surface-variant">
								{event.path.replace(/^\/hook\/[a-z0-9]+/, "") || "/"}
							</span>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="text-on-surface-muted hover:text-on-surface transition-colors"
					>
						<X size={16} strokeWidth={2} />
					</button>
				</div>

				{/* Body */}
				<div className="flex-1 overflow-y-auto p-5 space-y-5">
					<div>
						<label
							htmlFor="replay-headers"
							className="block text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-2"
						>
							Headers <span className="text-on-surface-faint normal-case">(one per line)</span>
						</label>
						<textarea
							id="replay-headers"
							value={headersText}
							onChange={(e) => setHeadersText(e.target.value)}
							rows={6}
							spellCheck={false}
							className="w-full bg-background border border-border rounded-md px-3 py-2 font-mono text-[12px] text-on-surface placeholder-on-surface-faint focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
						/>
					</div>

					<div>
						<label
							htmlFor="replay-body"
							className="block text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-2"
						>
							Body
						</label>
						<textarea
							id="replay-body"
							value={body}
							onChange={(e) => setBody(e.target.value)}
							rows={10}
							spellCheck={false}
							className="w-full bg-background border border-border rounded-md px-3 py-2 font-mono text-[12px] text-on-surface placeholder-on-surface-faint focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
						/>
					</div>

					{error && (
						<div
							role="alert"
							className="text-[11px] font-mono text-danger bg-danger/5 border border-danger/15 rounded-md px-3 py-2"
						>
							{error}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border-subtle bg-surface-muted">
					<span className="text-[11px] text-on-surface-muted">
						This creates a new event in the feed.
					</span>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onClose}
							className="px-3 py-1.5 bg-transparent text-on-surface-variant font-semibold rounded-md text-[12px] hover:text-on-surface transition-colors"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={handleSubmit}
							disabled={submitting}
							className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-background font-bold rounded-md text-[12px] hover:bg-primary-dim transition-colors disabled:opacity-60"
						>
							<Send size={12} strokeWidth={2.25} />
							{submitting ? "Sending…" : "Fire request"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
