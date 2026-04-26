import { Key, ShieldAlert, ShieldCheck, ShieldOff, ShieldX } from "lucide-react";
import { useEffect, useState } from "react";
import {
	type SignatureInfo,
	detectProvider,
	providerDisplayName,
	verifySignature,
} from "../../lib/signatures";

interface SignatureBadgeProps {
	headers: Record<string, string>;
	body: string | null;
	secrets: Record<string, string>;
	onConfigureSecret?: (providerId: string) => void;
}

/**
 * Small badge summarising the signature state of a single event:
 *   - Unknown provider  → hidden entirely (no clutter)
 *   - Known but no secret configured → amber "configure" nudge
 *   - Known + secret + valid → green tick
 *   - Known + secret + invalid → red cross
 *
 * Verification runs in an effect because SubtleCrypto is async.
 */
export function SignatureBadge({ headers, body, secrets, onConfigureSecret }: SignatureBadgeProps) {
	const info = detectProvider(headers);
	const secret = info.provider !== "unknown" ? secrets[info.provider] : undefined;
	const [valid, setValid] = useState<boolean | null>(null);

	useEffect(() => {
		if (info.provider === "unknown" || !secret) {
			setValid(null);
			return;
		}
		let cancelled = false;
		verifySignature(info, body, secret).then((result) => {
			if (!cancelled) setValid(result);
		});
		return () => {
			cancelled = true;
		};
	}, [info, body, secret]);

	if (info.provider === "unknown") return null;

	const name = providerDisplayName(info.provider);

	if (!secret) {
		return (
			<button
				type="button"
				onClick={() => onConfigureSecret?.(info.provider)}
				className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-warning/10 text-warning border border-warning/25 hover:bg-warning/15 transition-colors"
				title={`Add your ${name} signing secret to verify`}
			>
				<Key size={11} strokeWidth={2} />
				{name} · add secret
			</button>
		);
	}

	if (valid === null) {
		return (
			<span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-surface-2 text-on-surface-muted border border-border-subtle">
				<ShieldAlert size={11} strokeWidth={2} />
				{name} · checking
			</span>
		);
	}

	if (valid === false) {
		return (
			<span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-danger/10 text-danger border border-danger/25">
				<ShieldX size={11} strokeWidth={2} />
				{name} · invalid
			</span>
		);
	}

	return (
		<span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-success/10 text-success border border-success/25">
			<ShieldCheck size={11} strokeWidth={2} />
			{name} · verified
		</span>
	);
}

/** Tiny compatibility helper for any "no detection" callers. */
export { ShieldOff };
