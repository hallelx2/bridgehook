/**
 * Magic-link sign-in page. Submits email → Better-Auth sends the link →
 * we redirect to /login/check-email which is just a "look in your inbox"
 * placeholder.
 */
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "../components/Logo";
import { signIn } from "../lib/auth-client";

export function Login() {
	const navigate = useNavigate();
	const [search] = useSearchParams();
	const [email, setEmail] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Where to land after the magic link is clicked. Defaults to dashboard;
	// the device-pairing flow passes ?next=/connect?code=... so we honor it.
	const next = search.get("next") || "/dashboard";

	async function onSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			const callbackURL = new URL(next, window.location.origin).toString();
			const result = await signIn.magicLink({ email, callbackURL });
			if (result.error) {
				setError(result.error.message || "Could not send magic link");
				setSubmitting(false);
				return;
			}
			navigate(`/login/check-email?email=${encodeURIComponent(email)}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Network error");
			setSubmitting(false);
		}
	}

	return (
		<div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
			<header className="px-8 py-6">
				<Link to="/" className="inline-flex items-center gap-2">
					<Logo />
				</Link>
			</header>

			<main className="flex-1 flex items-center justify-center px-6">
				<div className="w-full max-w-sm">
					<h1 className="text-2xl font-semibold mb-2">Sign in to BridgeHook</h1>
					<p className="text-sm text-gray-400 mb-8">
						We'll email you a one-time link. No password.
					</p>

					<form onSubmit={onSubmit} className="space-y-4">
						<div>
							<label
								htmlFor="email"
								className="block text-xs uppercase tracking-wider text-gray-500 mb-2"
							>
								Email
							</label>
							<input
								id="email"
								type="email"
								required
								// biome-ignore lint/a11y/noAutofocus: single-input sign-in form, focus on mount is the expected UX
								autoFocus
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								className="w-full bg-gray-900 border border-gray-800 rounded-md px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-cyan-500"
								placeholder="you@example.com"
								disabled={submitting}
							/>
						</div>

						{error ? (
							<div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
								{error}
							</div>
						) : null}

						<button
							type="submit"
							disabled={submitting || !email}
							className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-gray-950 font-medium rounded-md py-2.5 text-sm transition-colors"
						>
							{submitting ? "Sending link…" : "Send magic link"}
						</button>
					</form>

					<p className="mt-8 text-xs text-gray-500">
						By signing in you agree we can use your email to deliver the magic link and send service
						notifications. No marketing.
					</p>
				</div>
			</main>
		</div>
	);
}
