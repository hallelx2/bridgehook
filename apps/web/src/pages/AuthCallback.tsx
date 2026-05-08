/**
 * Catch-all auth callback. Better-Auth's magic-link verifier on the
 * relay handles the actual session creation and 302s us back here (or
 * straight to whatever callbackURL was passed). We just inspect the
 * session: signed-in → /dashboard, otherwise → /login with an error.
 */
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { useSession } from "../lib/auth-client";

export function AuthCallback() {
	const navigate = useNavigate();
	const [search] = useSearchParams();
	const { data: session, isPending } = useSession();
	const error = search.get("error");
	const next = search.get("next") || "/dashboard";

	useEffect(() => {
		if (isPending) return;
		if (error) {
			const msg = encodeURIComponent(`Sign-in failed: ${error}`);
			navigate(`/login?error=${msg}`, { replace: true });
			return;
		}
		if (session?.user) {
			navigate(next, { replace: true });
			return;
		}
		// No session and no error — Better-Auth's redirect didn't carry us
		// through. Send back to /login.
		navigate("/login?error=session-not-set", { replace: true });
	}, [isPending, session, error, next, navigate]);

	return (
		<div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
			<header className="px-8 py-6">
				<Link to="/" className="inline-flex items-center gap-2">
					<Logo />
				</Link>
			</header>
			<main className="flex-1 flex items-center justify-center">
				<div className="text-sm text-gray-400 font-mono">finishing sign-in…</div>
			</main>
		</div>
	);
}
