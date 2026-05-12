/**
 * Sign-in page. Renders whatever auth providers the relay has been
 * configured for (Google, GitHub, magic-link) based on /api/config.
 *
 * - OAuth providers: one click → redirect to provider → relay /auth/callback
 *   → back to `next`. Provider returns email_verified, so the user lands in
 *   the dashboard immediately with no separate verification step.
 * - Magic-link: kept as a fallback for hosts that have mail wired up. Hidden
 *   at launch since we don't have a corporate sending domain yet.
 *
 * Self-host (config.authEnabled === false) shouldn't reach this page — the
 * router lands users directly in /dashboard.
 */
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "../components/Logo";
import { signIn } from "../lib/auth-client";
import { useConfig } from "../lib/config";

export function Login() {
	const navigate = useNavigate();
	const [search] = useSearchParams();
	const { config, loading: configLoading } = useConfig();
	const [email, setEmail] = useState("");
	const [submitting, setSubmitting] = useState<"google" | "github" | "magic" | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Where to land after sign-in. Defaults to dashboard; the device-pairing
	// flow passes ?next=/connect?code=... so we honor it.
	const next = search.get("next") || "/dashboard";
	const callbackURL = new URL(next, window.location.origin).toString();

	async function onOAuth(provider: "google" | "github") {
		setError(null);
		setSubmitting(provider);
		try {
			const result = await signIn.social({ provider, callbackURL });
			if (result.error) {
				setError(result.error.message || `Could not sign in with ${provider}`);
				setSubmitting(null);
			}
			// On success Better-Auth navigates the browser to the provider's
			// authorize URL; we don't reach this line in practice.
		} catch (err) {
			setError(err instanceof Error ? err.message : "Network error");
			setSubmitting(null);
		}
	}

	async function onMagicLink(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setSubmitting("magic");
		try {
			const result = await signIn.magicLink({ email, callbackURL });
			if (result.error) {
				setError(result.error.message || "Could not send magic link");
				setSubmitting(null);
				return;
			}
			navigate(`/login/check-email?email=${encodeURIComponent(email)}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Network error");
			setSubmitting(null);
		}
	}

	const providers = config?.authProviders ?? {
		google: false,
		github: false,
		magicLink: false,
	};
	const anyProvider = providers.google || providers.github || providers.magicLink;

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
						No passwords. Your email arrives pre-verified from your provider.
					</p>

					{configLoading ? (
						<div className="text-sm text-gray-500 py-12 text-center font-mono">loading…</div>
					) : !anyProvider ? (
						<div className="rounded-md border border-amber-900 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
							No sign-in providers are configured on this relay. Set <code>GOOGLE_CLIENT_ID</code> /{" "}
							<code>GITHUB_CLIENT_ID</code> (plus their secrets) on the worker and reload.
						</div>
					) : (
						<>
							<div className="space-y-2.5">
								{providers.google ? (
									<button
										type="button"
										onClick={() => onOAuth("google")}
										disabled={submitting !== null}
										className="w-full flex items-center justify-center gap-2.5 bg-white hover:bg-gray-100 disabled:bg-gray-700 disabled:text-gray-400 text-gray-900 font-medium rounded-md py-2.5 text-sm transition-colors"
									>
										<GoogleLogo />
										{submitting === "google" ? "Redirecting…" : "Continue with Google"}
									</button>
								) : null}
								{providers.github ? (
									<button
										type="button"
										onClick={() => onOAuth("github")}
										disabled={submitting !== null}
										className="w-full flex items-center justify-center gap-2.5 bg-gray-900 hover:bg-gray-800 border border-gray-800 disabled:bg-gray-900/50 disabled:text-gray-500 text-gray-100 font-medium rounded-md py-2.5 text-sm transition-colors"
									>
										<GitHubLogo />
										{submitting === "github" ? "Redirecting…" : "Continue with GitHub"}
									</button>
								) : null}
							</div>

							{providers.magicLink && (providers.google || providers.github) ? (
								<div className="my-6 flex items-center gap-3 text-[10px] uppercase tracking-wider text-gray-600">
									<div className="flex-1 h-px bg-gray-900" />
									or
									<div className="flex-1 h-px bg-gray-900" />
								</div>
							) : null}

							{providers.magicLink ? (
								<form onSubmit={onMagicLink} className="space-y-4">
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
											value={email}
											onChange={(e) => setEmail(e.target.value)}
											className="w-full bg-gray-900 border border-gray-800 rounded-md px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-cyan-500"
											placeholder="you@example.com"
											disabled={submitting !== null}
										/>
									</div>
									<button
										type="submit"
										disabled={submitting !== null || !email}
										className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-gray-950 font-medium rounded-md py-2.5 text-sm transition-colors"
									>
										{submitting === "magic" ? "Sending link…" : "Send magic link"}
									</button>
								</form>
							) : null}
						</>
					)}

					{error ? (
						<div className="mt-4 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
							{error}
						</div>
					) : null}

					<p className="mt-8 text-xs text-gray-500">
						By signing in you agree we can use your email to identify your account and send service
						notifications. No marketing.
					</p>
				</div>
			</main>
		</div>
	);
}

function GoogleLogo() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
			<title>Google</title>
			<path
				fill="#4285F4"
				d="M15.68 8.182c0-.567-.05-1.117-.146-1.645H8v3.107h4.305a3.68 3.68 0 0 1-1.595 2.417v2.013h2.583c1.51-1.39 2.387-3.44 2.387-5.892z"
			/>
			<path
				fill="#34A853"
				d="M8 16c2.16 0 3.97-.715 5.293-1.943l-2.583-2.013c-.716.48-1.633.763-2.71.763-2.084 0-3.85-1.408-4.48-3.3H.85v2.077A8 8 0 0 0 8 16z"
			/>
			<path
				fill="#FBBC05"
				d="M3.52 9.507A4.81 4.81 0 0 1 3.265 8c0-.523.09-1.03.255-1.507V4.416H.85a8 8 0 0 0 0 7.168l2.67-2.077z"
			/>
			<path
				fill="#EA4335"
				d="M8 3.193c1.175 0 2.23.404 3.06 1.197l2.293-2.293C11.965.799 10.155 0 8 0A8 8 0 0 0 .85 4.416l2.67 2.077C4.15 4.6 5.916 3.193 8 3.193z"
			/>
		</svg>
	);
}

function GitHubLogo() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<title>GitHub</title>
			<path d="M8 0C3.58 0 0 3.582 0 8c0 3.535 2.292 6.533 5.47 7.59.4.075.547-.172.547-.385 0-.19-.007-.693-.01-1.36-2.226.483-2.695-1.073-2.695-1.073-.364-.924-.89-1.17-.89-1.17-.725-.496.056-.486.056-.486.803.056 1.224.823 1.224.823.714 1.223 1.873.87 2.328.665.072-.517.279-.87.508-1.07-1.776-.2-3.644-.888-3.644-3.953 0-.873.31-1.587.823-2.147-.083-.202-.357-1.015.077-2.117 0 0 .672-.215 2.2.82A7.683 7.683 0 0 1 8 4.408a7.706 7.706 0 0 1 2.003.27c1.527-1.034 2.198-.82 2.198-.82.435 1.102.162 1.915.08 2.117.512.56.822 1.274.822 2.147 0 3.073-1.872 3.75-3.653 3.946.287.246.543.735.543 1.48 0 1.07-.01 1.933-.01 2.197 0 .214.145.463.55.385C13.71 14.53 16 11.534 16 8c0-4.418-3.582-8-8-8z" />
		</svg>
	);
}
