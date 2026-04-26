import { invoke } from "@tauri-apps/api/core";
import { useEffect, useId, useState } from "react";
import type { ReplayResult } from "../hooks/useEvents";
import type { Service } from "../hooks/useServices";
import { cn } from "../lib/cn";
import { JsonViewer } from "./JsonViewer";

interface ManualSenderProps {
	services: Service[];
	defaultServiceId?: string | null;
	onClose: () => void;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function methodClass(method: string): string {
	switch (method.toUpperCase()) {
		case "GET":
			return "method-get";
		case "POST":
			return "method-post";
		case "PUT":
			return "method-put";
		case "PATCH":
			return "method-patch";
		case "DELETE":
			return "method-delete";
		default:
			return "method-default";
	}
}

function statusTone(status: number) {
	if (status < 300) return "text-ok border-ok/30 bg-ok/5";
	if (status < 400) return "text-warn border-warn/30 bg-warn/5";
	return "text-err border-err/30 bg-err/5";
}

export function ManualSender({ services, defaultServiceId, onClose }: ManualSenderProps) {
	const [serviceId, setServiceId] = useState<string>(defaultServiceId || services[0]?.id || "");
	const [method, setMethod] = useState<string>("POST");
	const [path, setPath] = useState<string>("/webhook");
	const [headersText, setHeadersText] = useState<string>(
		`{\n  "Content-Type": "application/json"\n}`,
	);
	const [body, setBody] = useState<string>(`{\n  "hello": "world"\n}`);
	const [sending, setSending] = useState(false);
	const [result, setResult] = useState<ReplayResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	const ids = {
		svc: useId(),
		method: useId(),
		path: useId(),
		headers: useId(),
		body: useId(),
	};

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);

	const send = async () => {
		let headers: Record<string, string> = {};
		try {
			headers = headersText.trim() ? JSON.parse(headersText) : {};
			if (typeof headers !== "object" || Array.isArray(headers)) {
				throw new Error("Headers must be a JSON object");
			}
		} catch (e) {
			setError(`Invalid headers: ${String(e)}`);
			return;
		}
		setError(null);
		setSending(true);
		try {
			const res = await invoke<ReplayResult>("send_manual_request", {
				serviceId,
				method,
				path,
				headers,
				body,
			});
			setResult(res);
		} catch (e) {
			setError(String(e));
		} finally {
			setSending(false);
		}
	};

	const input =
		"w-full bg-ink-0 border border-edge rounded-sm px-2 h-7 text-caption text-fg placeholder-fg-ghost focus:outline-none focus:border-uranium/40 transition-colors tabular";
	const textareaCls =
		"w-full bg-ink-0 border border-edge rounded-sm px-2 py-1.5 text-caption text-fg placeholder-fg-ghost focus:outline-none focus:border-uranium/40 transition-colors tabular";
	const label = "block text-micro font-semibold text-fg-faint uppercase tracking-[0.18em] mb-1";

	return (
		<div
			className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6 animate-fade-in-up"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
			// biome-ignore lint/a11y/useSemanticElements: custom modal, not native <dialog>
			role="dialog"
			aria-modal="true"
		>
			<div
				className="w-[min(880px,100%)] max-h-[90vh] overflow-y-auto glass border border-edge-strong rounded-sm shadow-modal font-sans"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="presentation"
			>
				<div className="flex items-center justify-between px-4 h-10 border-b border-edge bg-ink-2/60 sticky top-0 z-10">
					<div className="flex items-center gap-2">
						<span className="text-uranium font-bold">→</span>
						<h2 className="text-ui font-semibold text-fg tracking-tight">send test request</h2>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="w-6 h-6 flex items-center justify-center text-fg-faint hover:text-fg hover:bg-ink-3 rounded text-base"
					>
						×
					</button>
				</div>

				<div className="grid grid-cols-[1.3fr_1fr]">
					<div className="p-4 space-y-3 border-r border-edge">
						<div className="grid grid-cols-[1fr_90px_2fr] gap-2">
							<div>
								<label htmlFor={ids.svc} className={label}>
									service
								</label>
								<select
									id={ids.svc}
									className={input}
									value={serviceId}
									onChange={(e) => setServiceId(e.target.value)}
								>
									{services.map((s) => (
										<option key={s.id} value={s.id}>
											{s.name} ·:{s.port}
										</option>
									))}
								</select>
							</div>
							<div>
								<label htmlFor={ids.method} className={label}>
									verb
								</label>
								<select
									id={ids.method}
									className={cn(input, "font-bold uppercase tabular", methodClass(method))}
									value={method}
									onChange={(e) => setMethod(e.target.value)}
								>
									{METHODS.map((m) => (
										<option key={m} value={m}>
											{m}
										</option>
									))}
								</select>
							</div>
							<div>
								<label htmlFor={ids.path} className={label}>
									path
								</label>
								<input
									id={ids.path}
									className={input}
									value={path}
									onChange={(e) => setPath(e.target.value)}
								/>
							</div>
						</div>

						<div>
							<label htmlFor={ids.headers} className={label}>
								headers · json
							</label>
							<textarea
								id={ids.headers}
								rows={5}
								className={textareaCls}
								value={headersText}
								onChange={(e) => setHeadersText(e.target.value)}
								spellCheck={false}
							/>
						</div>

						<div>
							<label htmlFor={ids.body} className={label}>
								body
							</label>
							<textarea
								id={ids.body}
								rows={8}
								className={textareaCls}
								value={body}
								onChange={(e) => setBody(e.target.value)}
								spellCheck={false}
							/>
						</div>

						{error && (
							<p className="text-err text-caption tabular">
								<span className="font-bold mr-1">!</span>
								{error}
							</p>
						)}

						<div className="flex items-center justify-end gap-2 pt-2">
							<button
								type="button"
								onClick={onClose}
								className="px-2.5 h-7 text-caption uppercase tracking-wider rounded-sm border border-edge text-fg-muted hover:text-fg hover:bg-ink-3 transition-colors"
							>
								close
							</button>
							<button
								type="button"
								disabled={sending || !serviceId}
								onClick={send}
								className="px-2.5 h-7 text-caption uppercase tracking-wider font-semibold rounded-sm bg-uranium text-uranium-ink hover:bg-uranium-dim disabled:opacity-30 transition-colors"
							>
								{sending ? "sending…" : "→ send"}
							</button>
						</div>
					</div>

					<div className="p-4 space-y-3 bg-ink-1/50">
						<h3 className="text-micro font-semibold uppercase tracking-[0.18em] text-fg flex items-center gap-1.5">
							<span className="text-uranium">/</span>
							response
						</h3>
						{!result ? (
							<div className="border border-dashed border-edge rounded-sm p-4 text-caption text-fg-faint text-center">
								<div className="text-fg-ghost mb-1">∅</div>
								<span>no response yet</span>
							</div>
						) : (
							<div className="space-y-3">
								<div className="flex items-center gap-2 text-caption tabular">
									<span
										className={cn(
											"inline-flex items-center px-1.5 py-px rounded-sm border font-bold",
											statusTone(result.status),
										)}
									>
										{result.status}
									</span>
									<span className="text-fg-muted">
										{result.latency_ms}
										<span className="text-fg-ghost ml-0.5">ms</span>
									</span>
								</div>
								<div>
									<p className="text-micro text-fg-faint uppercase tracking-[0.18em] mb-1">
										<span className="text-fg-ghost mr-1">/</span>
										body
									</p>
									<JsonViewer value={result.body} maxHeight={320} />
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
