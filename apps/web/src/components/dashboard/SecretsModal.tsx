import { Eye, EyeOff, Key, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { type ProviderId, providerDisplayName } from "../../lib/signatures";

const SUPPORTED: ProviderId[] = ["stripe", "github", "shopify"];

interface SecretsModalProps {
	open: boolean;
	highlight?: string | null;
	secrets: Record<string, string>;
	onChange: (provider: string, secret: string) => void;
	onClose: () => void;
}

/**
 * Lets the user paste signing secrets for known providers. Secrets live
 * in localStorage only — never sent to the relay. They're used purely
 * client-side to verify HMAC signatures via SubtleCrypto.
 */
export function SecretsModal({ open, highlight, secrets, onChange, onClose }: SecretsModalProps) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
			onClick={onClose}
			onKeyDown={(e) => e.key === "Escape" && onClose()}
			// biome-ignore lint/a11y/useSemanticElements: native <dialog> requires imperative showModal()/close() that doesn't fit our React-driven open state
			role="dialog"
			aria-modal="true"
			aria-label="Manage signing secrets"
		>
			<div
				className="bg-surface border border-border-strong rounded-xl shadow-[0_40px_100px_-30px_rgba(0,0,0,0.8)] w-full max-w-xl max-h-[85vh] flex flex-col mx-4"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="document"
			>
				<div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle bg-surface-muted">
					<div className="flex items-center gap-2">
						<Key size={14} strokeWidth={2} className="text-primary" />
						<span className="text-[11px] font-bold text-on-surface uppercase tracking-[0.25em]">
							Signing secrets
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

				<div className="px-5 py-4 text-[12px] text-on-surface-variant border-b border-border-subtle">
					Paste your signing secret for any provider below. Secrets stay in your browser and are
					used to verify HMAC signatures locally — they're never sent to the relay.
				</div>

				<div className="flex-1 overflow-y-auto p-5 space-y-4">
					{SUPPORTED.map((id) => (
						<SecretRow
							key={id}
							providerId={id}
							value={secrets[id] ?? ""}
							highlighted={highlight === id}
							onChange={(value) => onChange(id, value)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

function SecretRow({
	providerId,
	value,
	highlighted,
	onChange,
}: {
	providerId: ProviderId;
	value: string;
	highlighted: boolean;
	onChange: (value: string) => void;
}) {
	const [shown, setShown] = useState(false);
	const [draft, setDraft] = useState(value);
	const dirty = draft !== value;
	const name = providerDisplayName(providerId);

	useEffect(() => {
		setDraft(value);
	}, [value]);

	const placeholder = providerId === "stripe" ? "whsec_…" : "…";

	return (
		<div
			className={`p-3 rounded-md border ${
				highlighted ? "border-primary/40 bg-primary-soft" : "border-border bg-surface-muted"
			}`}
		>
			<div className="flex items-center justify-between mb-2">
				<span className="text-[12px] font-bold text-on-surface">{name}</span>
				{value && (
					<button
						type="button"
						onClick={() => onChange("")}
						className="inline-flex items-center gap-1 text-[10px] font-bold text-on-surface-muted hover:text-danger transition-colors"
					>
						<Trash2 size={11} strokeWidth={2} />
						Remove
					</button>
				)}
			</div>
			<div className="flex items-stretch gap-2">
				<div className="relative flex-1">
					<input
						type={shown ? "text" : "password"}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						placeholder={placeholder}
						spellCheck={false}
						className="w-full bg-background border border-border-subtle rounded-md pl-3 pr-9 py-2 font-mono text-[12px] text-on-surface placeholder-on-surface-faint focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
					/>
					<button
						type="button"
						onClick={() => setShown((v) => !v)}
						aria-label={shown ? "Hide secret" : "Show secret"}
						className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-muted hover:text-on-surface transition-colors"
					>
						{shown ? <EyeOff size={13} strokeWidth={2} /> : <Eye size={13} strokeWidth={2} />}
					</button>
				</div>
				<button
					type="button"
					onClick={() => onChange(draft)}
					disabled={!dirty}
					className="px-3 rounded-md text-[10px] font-bold uppercase tracking-wider bg-primary text-background hover:bg-primary-dim transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
				>
					Save
				</button>
			</div>
		</div>
	);
}
