import { Beaker, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { MockConfig } from "../../hooks/useBridge";

interface MockResponseSettingsProps {
	mock: MockConfig;
	onChange: (update: Partial<MockConfig>) => void;
	open: boolean;
	onClose: () => void;
}

/**
 * Settings drawer for canned (mock) responses. When mock mode is on, the
 * bridge stops forwarding to localhost and replies to every webhook with
 * the configured status / body / headers. Useful for testing whether a
 * webhook *sender* retries on 500, deduplicates on 200, etc.
 */
export function MockResponseSettings({ mock, onChange, open, onClose }: MockResponseSettingsProps) {
	const [localStatus, setLocalStatus] = useState(String(mock.status));
	const [localBody, setLocalBody] = useState(mock.body);
	const [localHeadersText, setLocalHeadersText] = useState(
		Object.entries(mock.headers)
			.map(([k, v]) => `${k}: ${v}`)
			.join("\n"),
	);
	const [headerError, setHeaderError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		if (!open) return;
		setLocalStatus(String(mock.status));
		setLocalBody(mock.body);
		setLocalHeadersText(
			Object.entries(mock.headers)
				.map(([k, v]) => `${k}: ${v}`)
				.join("\n"),
		);
		setHeaderError(null);
		setSaved(false);
	}, [open, mock]);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	const parseHeaders = (text: string): Record<string, string> | null => {
		const out: Record<string, string> = {};
		for (const raw of text.split("\n")) {
			const line = raw.trim();
			if (!line) continue;
			const idx = line.indexOf(":");
			if (idx === -1) {
				setHeaderError(`Header missing ":" → ${line.slice(0, 40)}`);
				return null;
			}
			const k = line.slice(0, idx).trim();
			const v = line.slice(idx + 1).trim();
			if (!k) {
				setHeaderError(`Empty header name → ${line.slice(0, 40)}`);
				return null;
			}
			out[k] = v;
		}
		setHeaderError(null);
		return out;
	};

	const save = () => {
		const headers = parseHeaders(localHeadersText);
		if (headers === null) return;
		const status = Number.parseInt(localStatus, 10);
		if (!Number.isInteger(status) || status < 100 || status > 599) {
			setHeaderError("Status must be an integer 100–599");
			return;
		}
		onChange({ status, body: localBody, headers });
		setSaved(true);
		setTimeout(() => setSaved(false), 1500);
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
			onClick={onClose}
			onKeyDown={(e) => e.key === "Escape" && onClose()}
			// biome-ignore lint/a11y/useSemanticElements: native <dialog> requires imperative showModal()/close() that doesn't fit our React-driven open state
			role="dialog"
			aria-modal="true"
			aria-label="Mock response settings"
		>
			<div
				className="bg-surface border border-border-strong rounded-xl shadow-[0_40px_100px_-30px_rgba(0,0,0,0.8)] w-full max-w-2xl max-h-[85vh] flex flex-col mx-4"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="document"
			>
				{/* Header */}
				<div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle bg-surface-muted">
					<div className="flex items-center gap-2">
						<Beaker size={14} strokeWidth={2} className="text-primary" />
						<span className="text-[11px] font-bold text-on-surface uppercase tracking-[0.25em]">
							Mock response
						</span>
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
					{/* Toggle */}
					<label className="flex items-start gap-3 p-3 rounded-md border border-border-subtle bg-surface-muted cursor-pointer">
						<input
							type="checkbox"
							checked={mock.enabled}
							onChange={(e) => onChange({ enabled: e.target.checked })}
							className="mt-0.5 h-4 w-4 accent-primary"
						/>
						<div>
							<div className="text-[13px] font-bold text-on-surface">Enable mock mode</div>
							<div className="text-[11.5px] text-on-surface-variant leading-relaxed">
								Stop forwarding to localhost and reply to every incoming webhook with the canned
								response below. Useful for testing webhook senders without touching your dev server.
							</div>
						</div>
					</label>

					<div className="grid grid-cols-3 gap-3">
						<div className="col-span-1">
							<label
								htmlFor="mock-status"
								className="block text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-2"
							>
								Status
							</label>
							<input
								id="mock-status"
								type="number"
								min={100}
								max={599}
								value={localStatus}
								onChange={(e) => setLocalStatus(e.target.value)}
								className="w-full bg-background border border-border rounded-md px-3 py-2 font-mono text-sm text-on-surface focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
							/>
						</div>
						<div className="col-span-2">
							<label
								htmlFor="mock-headers"
								className="block text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-2"
							>
								Response headers
							</label>
							<textarea
								id="mock-headers"
								value={localHeadersText}
								onChange={(e) => setLocalHeadersText(e.target.value)}
								rows={3}
								spellCheck={false}
								className="w-full bg-background border border-border rounded-md px-3 py-2 font-mono text-[12px] text-on-surface focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
							/>
						</div>
					</div>

					<div>
						<label
							htmlFor="mock-body"
							className="block text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-2"
						>
							Response body
						</label>
						<textarea
							id="mock-body"
							value={localBody}
							onChange={(e) => setLocalBody(e.target.value)}
							rows={6}
							spellCheck={false}
							className="w-full bg-background border border-border rounded-md px-3 py-2 font-mono text-[12px] text-on-surface focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
						/>
					</div>

					{headerError && (
						<div
							role="alert"
							className="text-[11px] font-mono text-danger bg-danger/5 border border-danger/15 rounded-md px-3 py-2"
						>
							{headerError}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border-subtle bg-surface-muted">
					<span className="text-[11px] text-on-surface-muted">
						{mock.enabled ? (
							<span className="text-warning font-bold">Mock mode is active.</span>
						) : (
							"Save your canned response, then enable mock mode."
						)}
					</span>
					<button
						type="button"
						onClick={save}
						className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[12px] font-bold transition-colors ${
							saved
								? "bg-success/15 text-success border border-success/25"
								: "bg-primary text-background hover:bg-primary-dim"
						}`}
					>
						{saved ? (
							<>
								<Check size={12} strokeWidth={2.5} />
								Saved
							</>
						) : (
							"Save response"
						)}
					</button>
				</div>
			</div>
		</div>
	);
}
