/**
 * "Check your inbox" placeholder shown after the magic-link form is
 * submitted. The actual sign-in completes when the user clicks the
 * link from their email.
 */
import { Link, useSearchParams } from "react-router-dom";
import { Logo } from "../components/Logo";

export function LoginCheckEmail() {
	const [search] = useSearchParams();
	const email = search.get("email") || "your inbox";

	return (
		<div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
			<header className="px-8 py-6">
				<Link to="/" className="inline-flex items-center gap-2">
					<Logo />
				</Link>
			</header>

			<main className="flex-1 flex items-center justify-center px-6">
				<div className="w-full max-w-sm text-center">
					<div className="mx-auto mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
						<svg
							width="22"
							height="22"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<title>Email sent</title>
							<rect x="3" y="5" width="18" height="14" rx="2" />
							<path d="m3 7 9 6 9-6" />
						</svg>
					</div>
					<h1 className="text-xl font-semibold mb-2">Check your email</h1>
					<p className="text-sm text-gray-400 leading-relaxed">
						We sent a sign-in link to <span className="text-gray-200 font-mono">{email}</span>.
						Click it to finish signing in. The link is good for 15 minutes.
					</p>

					<div className="mt-10 text-xs text-gray-500 space-y-2">
						<p>
							Didn't get it? Check spam or{" "}
							<Link to="/login" className="text-cyan-400 hover:underline">
								try again
							</Link>
							.
						</p>
					</div>
				</div>
			</main>
		</div>
	);
}
