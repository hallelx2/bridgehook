/**
 * Device pairing approval page (?code=DV-XXXX-XXXX).
 *
 * Flow:
 *   1. Extension hits /auth/device/start, opens this URL in a new tab
 *   2. AuthGate ensures the user is signed in; if not, /login?next=/connect?code=...
 *   3. User confirms the device kind/label and clicks Approve
 *   4. We POST /auth/device/approve { code }
 *   5. Extension's polling /auth/device/exchange now returns { token, deviceId, ... }
 *      and the popup shows "Connected".
 */
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "../components/Logo";

const RELAY_URL = import.meta.env.VITE_RELAY_URL || "http://localhost:8787";
const CODE_RE = /^DV-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function Connect() {
	const navigate = useNavigate();
	const [search] = useSearchParams();
	const code = (search.get("code") || "").toUpperCase();
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [approved, setApproved] = useState(false);
	const [meta, setMeta] = useState<{ kind: string; labelHint: string | null } | null>(null);

	// Best-effort: try to peek metadata so we can show "Approve Chrome on macOS"
	// not just "Approve unknown device". Endpoint isn't built yet (Phase 2);
	// for now we just parse the kind out of the labelHint format.
	useEffect(() => {
		if (!CODE_RE.test(code)) return;
		// Code is opaque; the relay's /approve response gives us the kind. We
		// surface that on success rather than pre-fetching here.
	}, [code]);

	if (!CODE_RE.test(code)) {
		return (
			<Shell>
				<h1 className="text-xl font-semibold mb-2">Bad pairing code</h1>
				<p className="text-sm text-gray-400">
					This URL doesn't look like a device pairing link. Re-open the extension and try the
					connect flow again.
				</p>
				<button
					type="button"
					onClick={() => navigate("/dashboard")}
					className="mt-6 text-sm text-cyan-400 hover:underline"
				>
					Back to dashboard
				</button>
			</Shell>
		);
	}

	async function onApprove(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			const res = await fetch(`${RELAY_URL}/auth/device/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ code }),
			});
			const data = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				kind?: string;
				labelHint?: string | null;
				error?: string;
			};
			if (!res.ok) {
				setError(data.error || `Approval failed (${res.status})`);
				setSubmitting(false);
				return;
			}
			setApproved(true);
			if (data.kind) setMeta({ kind: data.kind, labelHint: data.labelHint ?? null });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Network error");
			setSubmitting(false);
		}
	}

	if (approved) {
		return (
			<Shell>
				<div className="mx-auto mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
					<svg
						width="22"
						height="22"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.5"
					>
						<title>Approved</title>
						<polyline points="20 6 9 17 4 12" />
					</svg>
				</div>
				<h1 className="text-xl font-semibold mb-2">Device approved</h1>
				<p className="text-sm text-gray-400 leading-relaxed">
					{meta?.labelHint ? (
						<span className="text-gray-200">{meta.labelHint}</span>
					) : (
						"Your device"
					)}{" "}
					can now use BridgeHook on this account. You can close this tab — the extension will pick
					up the signal automatically.
				</p>
				<button
					type="button"
					onClick={() => navigate("/dashboard")}
					className="mt-8 text-sm text-cyan-400 hover:underline"
				>
					Open dashboard →
				</button>
			</Shell>
		);
	}

	return (
		<Shell>
			<h1 className="text-xl font-semibold mb-2">Approve device pairing</h1>
			<p className="text-sm text-gray-400 mb-6 leading-relaxed">
				A BridgeHook executor is asking to connect to your account. Approving lets it create
				channels under your name and forward webhooks to your localhost.
			</p>

			<div className="rounded-md border border-gray-800 bg-gray-900/60 px-4 py-3 mb-6">
				<div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Pairing code</div>
				<div className="font-mono text-lg tracking-wider text-gray-100">{code}</div>
			</div>

			{error ? (
				<div className="mb-4 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
					{error}
				</div>
			) : null}

			<form onSubmit={onApprove} className="flex gap-3">
				<button
					type="submit"
					disabled={submitting}
					className="flex-1 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-gray-950 font-medium rounded-md py-2.5 text-sm transition-colors"
				>
					{submitting ? "Approving…" : "Approve"}
				</button>
				<button
					type="button"
					onClick={() => navigate("/dashboard")}
					className="px-4 text-sm text-gray-400 hover:text-gray-200"
				>
					Cancel
				</button>
			</form>

			<p className="mt-8 text-xs text-gray-500">
				Don't recognize this code? Don't approve. The extension that started this flow is the only
				place it can be claimed.
			</p>
		</Shell>
	);
}

function Shell({ children }: { children: React.ReactNode }) {
	return (
		<div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
			<header className="px-8 py-6">
				<Link to="/" className="inline-flex items-center gap-2">
					<Logo />
				</Link>
			</header>
			<main className="flex-1 flex items-center justify-center px-6">
				<div className="w-full max-w-sm">{children}</div>
			</main>
		</div>
	);
}
