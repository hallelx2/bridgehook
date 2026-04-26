import { invoke } from "@tauri-apps/api/core";
import { useEffect, useId, useState } from "react";
import { cn } from "../lib/cn";

interface SettingsModalProps {
	onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
	const retId = useId();
	const [retentionDays, setRetentionDays] = useState<number>(0);
	const [saving, setSaving] = useState(false);
	const [applying, setApplying] = useState(false);
	const [applyResult, setApplyResult] = useState<string | null>(null);
	const [clearResult, setClearResult] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		(async () => {
			try {
				const v = await invoke<string | null>("get_setting", { key: "retention_days" });
				if (v) setRetentionDays(Number(v) || 0);
			} catch {
				/* ignore */
			} finally {
				setLoaded(true);
			}
		})();
	}, []);

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);

	const saveRetention = async () => {
		setSaving(true);
		try {
			await invoke("set_setting", {
				key: "retention_days",
				value: String(retentionDays),
			});
		} finally {
			setSaving(false);
		}
	};

	const runRetention = async () => {
		setApplying(true);
		setApplyResult(null);
		try {
			const n = await invoke<number>("apply_event_retention", { days: retentionDays });
			setApplyResult(`deleted ${n} events older than ${retentionDays} days`);
		} catch (e) {
			setApplyResult(String(e));
		} finally {
			setApplying(false);
		}
	};

	const clearAll = async () => {
		setClearResult(null);
		if (!window.confirm("Clear ALL stored events across every service? This cannot be undone.")) {
			return;
		}
		try {
			const n = await invoke<number>("clear_all_events");
			setClearResult(`cleared ${n} events`);
		} catch (e) {
			setClearResult(String(e));
		}
	};

	const input =
		"bg-ink-0 border border-edge rounded-sm px-2 h-7 text-caption text-fg focus:outline-none focus:border-uranium/40 transition-colors tabular";

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
				className="w-[min(540px,100%)] glass border border-edge-strong rounded-sm shadow-modal font-sans"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="presentation"
			>
				<div className="flex items-center justify-between px-4 h-10 border-b border-edge bg-ink-2/60">
					<div className="flex items-center gap-2">
						<span className="text-uranium text-caption font-bold">⚙</span>
						<h2 className="text-ui font-semibold text-fg tracking-tight">settings</h2>
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
					<section className="space-y-2">
						<SectionHeader
							title="event retention"
							subtitle="Delete events older than N days. Runs on app startup and on demand. 0 keeps everything."
						/>
						<div className="flex items-center gap-2">
							<label htmlFor={retId} className="text-micro text-fg-faint uppercase tracking-widest">
								days
							</label>
							<input
								id={retId}
								type="number"
								min={0}
								className={cn(input, "w-20")}
								value={loaded ? retentionDays : 0}
								onChange={(e) => setRetentionDays(Number(e.target.value))}
							/>
							<button
								type="button"
								onClick={saveRetention}
								disabled={saving}
								className="px-2.5 h-7 text-caption uppercase tracking-wider rounded-sm border border-edge text-fg-muted hover:text-fg hover:bg-ink-3 disabled:opacity-30 transition-colors"
							>
								{saving ? "…" : "save"}
							</button>
							<button
								type="button"
								onClick={runRetention}
								disabled={applying || retentionDays <= 0}
								className="px-2.5 h-7 text-caption uppercase tracking-wider font-semibold rounded-sm bg-uranium text-uranium-ink hover:bg-uranium-dim disabled:opacity-30 transition-colors"
							>
								{applying ? "applying…" : "apply now"}
							</button>
						</div>
						{applyResult && <p className="text-micro text-fg-faint tabular">› {applyResult}</p>}
					</section>

					<div className="border-t border-dashed border-edge" />

					<section className="space-y-2">
						<SectionHeader
							title="clear all events"
							subtitle="Delete every stored event across all services. Cannot be undone."
						/>
						<button
							type="button"
							onClick={clearAll}
							className="px-2.5 h-7 text-caption uppercase tracking-wider rounded-sm border border-err/30 text-err bg-err/5 hover:bg-err/10 transition-colors"
						>
							× clear all events
						</button>
						{clearResult && <p className="text-micro text-fg-faint tabular">› {clearResult}</p>}
					</section>
				</div>

				<div className="flex items-center justify-end gap-3 px-4 h-9 border-t border-edge bg-ink-2/40 text-micro text-fg-ghost uppercase tracking-widest">
					<kbd className="px-1.5 py-px text-micro rounded-sm border border-edge bg-ink-2 text-fg-faint normal-case tracking-normal">
						esc
					</kbd>
					<span>close</span>
				</div>
			</div>
		</div>
	);
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
	return (
		<div>
			<h3 className="text-micro font-semibold uppercase tracking-[0.18em] text-fg flex items-center gap-1.5">
				<span className="text-uranium">/</span>
				{title}
			</h3>
			<p className="text-micro text-fg-faint mt-1 leading-relaxed normal-case tracking-normal">
				{subtitle}
			</p>
		</div>
	);
}
