import { invoke } from "@tauri-apps/api/core";
import { useEffect, useId, useState } from "react";
import type { Service } from "../hooks/useServices";
import { cn } from "../lib/cn";

interface ServiceConfigModalProps {
	service: Service;
	onClose: () => void;
	onSaved: () => void;
}

interface Environment {
	name: string;
	port: number;
	path_rewrite?: string;
}

export function ServiceConfigModal({ service, onClose, onSaved }: ServiceConfigModalProps) {
	const [form, setForm] = useState({
		name: service.name,
		port: service.port,
		path: service.path,
		path_rewrite: service.path_rewrite ?? "",
		injected_headers: service.injected_headers ?? "",
		timeout_ms: service.timeout_ms ?? 30000,
		retry_count: service.retry_count ?? 0,
		retry_delay_ms: service.retry_delay_ms ?? 1000,
		environments: service.environments ?? "",
		active_environment: service.active_environment ?? "",
		signing_provider: service.signing_provider ?? "",
		signing_secret: service.signing_secret ?? "",
		mock_response: service.mock_response ?? "",
		notify_on_event: service.notify_on_event ?? false,
	});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const ids = {
		name: useId(),
		port: useId(),
		path: useId(),
		rewrite: useId(),
		headers: useId(),
		timeout: useId(),
		retryCount: useId(),
		retryDelay: useId(),
		envs: useId(),
		activeEnv: useId(),
		signProvider: useId(),
		signSecret: useId(),
		mock: useId(),
		notify: useId(),
	};

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onClose]);

	const parsedEnvs = safeParse<Environment[]>(form.environments);

	const validate = (): string | null => {
		if (form.injected_headers.trim()) {
			try {
				const v = JSON.parse(form.injected_headers);
				if (typeof v !== "object" || v == null || Array.isArray(v)) {
					return "Injected headers must be a JSON object";
				}
			} catch {
				return "Injected headers: invalid JSON";
			}
		}
		if (form.environments.trim()) {
			try {
				const v = JSON.parse(form.environments);
				if (!Array.isArray(v)) return "Environments must be a JSON array";
			} catch {
				return "Environments: invalid JSON";
			}
		}
		if (form.mock_response.trim()) {
			try {
				const v = JSON.parse(form.mock_response);
				if (typeof v !== "object" || v == null)
					return "Mock response must be a JSON object with {status, headers, body}";
			} catch {
				return "Mock response: invalid JSON";
			}
		}
		return null;
	};

	const handleSave = async () => {
		const err = validate();
		if (err) {
			setError(err);
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await invoke<Service>("update_service", {
				service: {
					...service,
					name: form.name.trim() || service.name,
					port: form.port,
					path: form.path.trim() || service.path,
					path_rewrite: form.path_rewrite.trim() || null,
					injected_headers: form.injected_headers.trim() || null,
					timeout_ms: form.timeout_ms || null,
					retry_count: form.retry_count,
					retry_delay_ms: form.retry_delay_ms,
					environments: form.environments.trim() || null,
					active_environment: form.active_environment.trim() || null,
					signing_provider: form.signing_provider || null,
					signing_secret: form.signing_secret.trim() || null,
					mock_response: form.mock_response.trim() || null,
					notify_on_event: form.notify_on_event,
				},
			});
			onSaved();
			onClose();
		} catch (e) {
			setError(String(e));
		} finally {
			setSaving(false);
		}
	};

	const label = "block text-micro font-semibold text-fg-faint uppercase tracking-[0.18em] mb-1";
	const input =
		"w-full bg-ink-0 border border-edge rounded-sm px-2 h-7 text-caption text-fg placeholder-fg-ghost focus:outline-none focus:border-uranium/40 transition-colors tabular";
	const textareaCls =
		"w-full bg-ink-0 border border-edge rounded-sm px-2 py-1.5 text-caption text-fg placeholder-fg-ghost focus:outline-none focus:border-uranium/40 transition-colors tabular";

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
				className="w-[min(760px,100%)] max-h-[90vh] overflow-y-auto glass border border-edge-strong rounded-sm shadow-modal font-sans"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="presentation"
			>
				<div className="flex items-center justify-between px-4 h-10 border-b border-edge bg-ink-2/60 sticky top-0 z-10">
					<div className="flex items-center gap-2">
						<span className="text-uranium font-bold">⚙</span>
						<h2 className="text-ui font-semibold text-fg tracking-tight">
							service · <span className="text-fg-muted">{service.name}</span>
						</h2>
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

				<div className="p-4 space-y-5">
					<Section title="basics">
						<div className="grid grid-cols-3 gap-3">
							<Field>
								<label htmlFor={ids.name} className={label}>
									name
								</label>
								<input
									id={ids.name}
									className={input}
									value={form.name}
									onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
								/>
							</Field>
							<Field>
								<label htmlFor={ids.port} className={label}>
									port
								</label>
								<input
									id={ids.port}
									type="number"
									min={1}
									max={65535}
									className={input}
									value={form.port}
									onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))}
								/>
							</Field>
							<Field>
								<label htmlFor={ids.path} className={label}>
									default path
								</label>
								<input
									id={ids.path}
									className={input}
									value={form.path}
									onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
								/>
							</Field>
						</div>
					</Section>

					<Section
						title="path rewrite & headers"
						hint="Rewrite the incoming path before forwarding to localhost. Extra headers are injected into every forwarded request."
					>
						<Field>
							<label htmlFor={ids.rewrite} className={label}>
								path rewrite (optional)
							</label>
							<input
								id={ids.rewrite}
								className={input}
								value={form.path_rewrite}
								onChange={(e) => setForm((f) => ({ ...f, path_rewrite: e.target.value }))}
								placeholder="/api/webhook"
							/>
						</Field>
						<Field>
							<label htmlFor={ids.headers} className={label}>
								injected headers · json
							</label>
							<textarea
								id={ids.headers}
								rows={3}
								className={textareaCls}
								value={form.injected_headers}
								onChange={(e) => setForm((f) => ({ ...f, injected_headers: e.target.value }))}
								placeholder='{"X-Forwarded-For": "1.2.3.4"}'
								spellCheck={false}
							/>
						</Field>
					</Section>

					<Section title="timeouts & retries">
						<div className="grid grid-cols-3 gap-3">
							<Field>
								<label htmlFor={ids.timeout} className={label}>
									timeout · ms
								</label>
								<input
									id={ids.timeout}
									type="number"
									min={100}
									className={input}
									value={form.timeout_ms}
									onChange={(e) => setForm((f) => ({ ...f, timeout_ms: Number(e.target.value) }))}
								/>
							</Field>
							<Field>
								<label htmlFor={ids.retryCount} className={label}>
									retry count
								</label>
								<input
									id={ids.retryCount}
									type="number"
									min={0}
									max={10}
									className={input}
									value={form.retry_count}
									onChange={(e) => setForm((f) => ({ ...f, retry_count: Number(e.target.value) }))}
								/>
							</Field>
							<Field>
								<label htmlFor={ids.retryDelay} className={label}>
									retry delay · ms
								</label>
								<input
									id={ids.retryDelay}
									type="number"
									min={0}
									className={input}
									value={form.retry_delay_ms}
									onChange={(e) =>
										setForm((f) => ({ ...f, retry_delay_ms: Number(e.target.value) }))
									}
								/>
							</Field>
						</div>
					</Section>

					<Section
						title="environments"
						hint='JSON array. Example: [{"name":"dev","port":3000},{"name":"staging","port":4001,"path_rewrite":"/hook"}]'
					>
						<Field>
							<label htmlFor={ids.envs} className={label}>
								environments · json array
							</label>
							<textarea
								id={ids.envs}
								rows={3}
								className={textareaCls}
								value={form.environments}
								onChange={(e) => setForm((f) => ({ ...f, environments: e.target.value }))}
								spellCheck={false}
							/>
						</Field>
						<Field>
							<label htmlFor={ids.activeEnv} className={label}>
								active environment
							</label>
							{parsedEnvs ? (
								<select
									id={ids.activeEnv}
									className={input}
									value={form.active_environment}
									onChange={(e) => setForm((f) => ({ ...f, active_environment: e.target.value }))}
								>
									<option value="">·default — port/path above</option>
									{parsedEnvs.map((env) => (
										<option key={env.name} value={env.name}>
											{env.name} ·:{env.port}
											{env.path_rewrite ? ` ${env.path_rewrite}` : ""}
										</option>
									))}
								</select>
							) : (
								<input
									id={ids.activeEnv}
									className={input}
									value={form.active_environment}
									onChange={(e) => setForm((f) => ({ ...f, active_environment: e.target.value }))}
									placeholder="name of active env"
								/>
							)}
						</Field>
					</Section>

					<Section
						title="signature verification"
						hint="Verify incoming signatures from known providers. Result appears as x-bridgehook-signature on each event."
					>
						<div className="grid grid-cols-2 gap-3">
							<Field>
								<label htmlFor={ids.signProvider} className={label}>
									provider
								</label>
								<select
									id={ids.signProvider}
									className={input}
									value={form.signing_provider}
									onChange={(e) => setForm((f) => ({ ...f, signing_provider: e.target.value }))}
								>
									<option value="">·none</option>
									<option value="stripe">stripe</option>
									<option value="github">github</option>
									<option value="slack">slack</option>
								</select>
							</Field>
							<Field>
								<label htmlFor={ids.signSecret} className={label}>
									signing secret
								</label>
								<input
									id={ids.signSecret}
									type="password"
									className={input}
									value={form.signing_secret}
									onChange={(e) => setForm((f) => ({ ...f, signing_secret: e.target.value }))}
								/>
							</Field>
						</div>
					</Section>

					<Section
						title="mock response"
						hint="When set, localhost is skipped and this canned response is returned instead. Useful when the handler isn't written yet."
					>
						<Field>
							<label htmlFor={ids.mock} className={label}>
								mock response · json
							</label>
							<textarea
								id={ids.mock}
								rows={4}
								className={textareaCls}
								value={form.mock_response}
								onChange={(e) => setForm((f) => ({ ...f, mock_response: e.target.value }))}
								placeholder='{"status":200,"headers":{"Content-Type":"application/json"},"body":"{"ok":true}"}'
								spellCheck={false}
							/>
						</Field>
					</Section>

					<Section title="notifications">
						<label htmlFor={ids.notify} className="flex items-center gap-2 cursor-pointer group">
							<input
								id={ids.notify}
								type="checkbox"
								checked={form.notify_on_event}
								onChange={(e) => setForm((f) => ({ ...f, notify_on_event: e.target.checked }))}
								className="peer sr-only"
							/>
							<span
								className={cn(
									"w-4 h-4 rounded-sm border flex items-center justify-center transition-colors",
									form.notify_on_event
										? "border-uranium bg-uranium text-uranium-ink"
										: "border-edge bg-ink-0 group-hover:border-edge-strong",
								)}
							>
								{form.notify_on_event && (
									<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
										<path
											d="M2 5.5 L4 7.5 L8 2.5"
											stroke="currentColor"
											strokeWidth="1.5"
											strokeLinecap="square"
										/>
									</svg>
								)}
							</span>
							<span className="text-caption text-fg-muted group-hover:text-fg">
								Show a native notification on every event
							</span>
						</label>
					</Section>
				</div>

				<div className="flex items-center gap-2 px-4 h-11 border-t border-edge bg-ink-2/40 sticky bottom-0">
					{error && (
						<p className="text-err text-caption tabular mr-auto">
							<span className="font-bold mr-1">!</span>
							{error}
						</p>
					)}
					<button
						type="button"
						onClick={onClose}
						className="ml-auto px-2.5 h-7 text-caption uppercase tracking-wider rounded-sm border border-edge text-fg-muted hover:text-fg hover:bg-ink-3 transition-colors"
					>
						cancel
					</button>
					<button
						type="button"
						onClick={handleSave}
						disabled={saving}
						className="px-2.5 h-7 text-caption uppercase tracking-wider font-semibold rounded-sm bg-uranium text-uranium-ink hover:bg-uranium-dim disabled:opacity-30 transition-colors"
					>
						{saving ? "saving…" : "✓ save"}
					</button>
				</div>
			</div>
		</div>
	);
}

function Section({
	title,
	hint,
	children,
}: {
	title: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-2.5">
			<div className="flex items-center gap-2">
				<span className="h-3 w-0.5 bg-uranium" />
				<h3 className="text-micro font-semibold uppercase tracking-[0.18em] text-fg">{title}</h3>
				<span className="flex-1 border-t border-dashed border-edge" />
			</div>
			{hint && (
				<p className="text-micro text-fg-faint leading-relaxed normal-case tracking-normal">
					{hint}
				</p>
			)}
			<div className="space-y-2.5">{children}</div>
		</section>
	);
}

function Field({ children }: { children: React.ReactNode }) {
	return <div>{children}</div>;
}

function safeParse<T>(s: string): T | null {
	if (!s.trim()) return null;
	try {
		return JSON.parse(s) as T;
	} catch {
		return null;
	}
}
