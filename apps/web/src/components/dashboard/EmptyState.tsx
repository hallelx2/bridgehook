import { ArrowUpRight, Copy, Sparkles, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { PRESETS, type Preset } from "../../lib/providers";

interface EmptyStateProps {
	webhookUrl: string | null;
	onFireTest?: () => void;
}

/**
 * Shown while a channel is live but no events have arrived yet. Instead
 * of a lonely "waiting…" message we surface a gallery of popular providers
 * with concrete configuration recipes. Each preset can copy its specific
 * recommended events and links out to provider docs.
 */
export function EmptyState({ webhookUrl, onFireTest }: EmptyStateProps) {
	const [activeId, setActiveId] = useState<string | null>(null);
	const active = PRESETS.find((p) => p.id === activeId) ?? null;

	return (
		<div className="flex-1 overflow-y-auto">
			<div className="max-w-3xl mx-auto px-6 py-10">
				<div className="flex items-center gap-2 mb-1">
					<Sparkles size={14} strokeWidth={2} className="text-primary" />
					<span className="text-[10px] font-bold text-primary uppercase tracking-[0.25em]">
						Getting started
					</span>
				</div>
				<h2 className="text-2xl font-extrabold text-on-surface mb-2 tracking-tight">
					Point a provider at your webhook URL.
				</h2>
				<p className="text-on-surface-variant text-[14px] leading-relaxed mb-8">
					Pick one — BridgeHook will show every request the moment it lands. You can also
					<button
						type="button"
						onClick={onFireTest}
						className="underline decoration-border-strong hover:decoration-primary transition-colors ml-1 text-on-surface"
					>
						fire a test request
					</button>{" "}
					right now.
				</p>

				<div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
					{PRESETS.map((preset) => (
						<PresetCard
							key={preset.id}
							preset={preset}
							active={activeId === preset.id}
							onClick={() => setActiveId((id) => (id === preset.id ? null : preset.id))}
						/>
					))}
				</div>

				{active && <PresetDetail preset={active} webhookUrl={webhookUrl} />}
			</div>
		</div>
	);
}

function PresetCard({
	preset,
	active,
	onClick,
}: {
	preset: Preset;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`group text-left p-4 rounded-xl border transition-colors ${
				active
					? "bg-surface border-border-strong"
					: "bg-surface border-border hover:border-border-strong"
			}`}
		>
			<div className="flex items-start justify-between mb-2">
				<div
					className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-extrabold"
					style={{
						backgroundColor: `${preset.accent}22`,
						color: preset.accent,
						border: `1px solid ${preset.accent}44`,
					}}
				>
					{preset.name.charAt(0)}
				</div>
				<ArrowUpRight
					size={14}
					className={`${
						active ? "text-primary" : "text-on-surface-faint group-hover:text-on-surface-variant"
					} transition-colors`}
				/>
			</div>
			<div className="text-sm font-bold text-on-surface mb-1">{preset.name}</div>
			<div className="text-[11.5px] text-on-surface-muted leading-snug">{preset.blurb}</div>
		</button>
	);
}

function PresetDetail({ preset, webhookUrl }: { preset: Preset; webhookUrl: string | null }) {
	const [copiedEvents, setCopiedEvents] = useState(false);
	const [copiedUrl, setCopiedUrl] = useState(false);

	useEffect(() => {
		if (copiedEvents) {
			const t = setTimeout(() => setCopiedEvents(false), 2000);
			return () => clearTimeout(t);
		}
	}, [copiedEvents]);

	useEffect(() => {
		if (copiedUrl) {
			const t = setTimeout(() => setCopiedUrl(false), 2000);
			return () => clearTimeout(t);
		}
	}, [copiedUrl]);

	return (
		<div className="bg-surface border border-border rounded-xl overflow-hidden">
			<div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle bg-surface-muted">
				<div className="flex items-center gap-2">
					<span
						className="w-5 h-5 rounded flex items-center justify-center text-[11px] font-extrabold"
						style={{
							backgroundColor: `${preset.accent}22`,
							color: preset.accent,
							border: `1px solid ${preset.accent}44`,
						}}
					>
						{preset.name.charAt(0)}
					</span>
					<span className="text-[11px] font-bold text-on-surface uppercase tracking-[0.2em]">
						Wire up {preset.name}
					</span>
				</div>
				<a
					href={preset.docsUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 text-[11px] font-bold text-on-surface-variant hover:text-primary transition-colors no-underline"
				>
					Docs <ArrowUpRight size={11} strokeWidth={2.25} />
				</a>
			</div>

			<div className="p-5 space-y-5">
				<div>
					<div className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-2">
						Webhook URL
					</div>
					<div className="flex items-stretch gap-2">
						<div className="flex-1 bg-background border border-border rounded-md px-3 py-2 font-mono text-[11.5px] text-primary overflow-x-auto">
							{webhookUrl ?? "—"}
						</div>
						{webhookUrl && (
							<button
								type="button"
								onClick={() => {
									navigator.clipboard.writeText(webhookUrl);
									setCopiedUrl(true);
								}}
								className={`shrink-0 px-3 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${
									copiedUrl
										? "bg-success/15 text-success border border-success/25"
										: "bg-primary-soft text-primary border border-primary/30 hover:bg-primary/20"
								}`}
							>
								{copiedUrl ? "Copied" : "Copy"}
							</button>
						)}
					</div>
				</div>

				<div>
					<div className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-2">
						Steps
					</div>
					<ol className="space-y-1.5 pl-4 list-decimal marker:text-on-surface-faint marker:text-[11px] marker:font-mono">
						{preset.steps.map((step) => (
							<li key={step} className="text-[13px] text-on-surface-variant leading-relaxed">
								{step}
							</li>
						))}
					</ol>
				</div>

				<div>
					<div className="flex items-center justify-between mb-2">
						<div className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.25em]">
							Recommended events
						</div>
						<button
							type="button"
							onClick={() => {
								navigator.clipboard.writeText(preset.events.join("\n"));
								setCopiedEvents(true);
							}}
							className="inline-flex items-center gap-1 text-[10px] font-bold text-on-surface-muted hover:text-on-surface transition-colors"
						>
							<Copy size={11} strokeWidth={2} />
							{copiedEvents ? "Copied" : "Copy all"}
						</button>
					</div>
					<div className="flex flex-wrap gap-1.5">
						{preset.events.map((evt) => (
							<span
								key={evt}
								className="font-mono text-[11px] px-2 py-1 rounded bg-background border border-border-subtle text-on-surface-variant"
							>
								{evt}
							</span>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

/**
 * Small "fire a test" helper — not a preset, the user just wants a quick
 * smoke test. Exposed separately so the EmptyState parent can wire it up
 * to the dashboard's own curl-runner.
 */
export function FireTestButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="inline-flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-md text-[12px] font-semibold text-on-surface hover:border-border-strong transition-colors"
		>
			<Terminal size={13} strokeWidth={2} />
			Fire a test request
		</button>
	);
}
