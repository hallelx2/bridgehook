/**
 * Route guard for /dashboard/* and other auth-required surfaces.
 *
 * Behavior:
 *   - In self-host mode (config.authEnabled === false) → renders children
 *     unconditionally. The dashboard pages render against the implicit
 *     single user via the existing useAnonymousBridge fallback.
 *   - In hosted mode + signed-in → renders children.
 *   - In hosted mode + signed-out → redirects to /login?next=<current path>.
 *   - While the session check is in flight → minimal loading shell.
 */
import { type ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "../lib/auth-client";
import { useConfig } from "../lib/config";

interface AuthGateProps {
	children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
	const { config, loading: configLoading } = useConfig();
	const { data: session, isPending: sessionLoading } = useSession();
	const location = useLocation();
	const [readyToCheck, setReadyToCheck] = useState(false);

	// Give the session probe a moment so we don't flash login on every nav.
	useEffect(() => {
		if (!configLoading && !sessionLoading) setReadyToCheck(true);
	}, [configLoading, sessionLoading]);

	if (!readyToCheck) {
		return <LoadingShell />;
	}

	// Self-host: gate is open.
	if (config && !config.authEnabled) {
		return <>{children}</>;
	}

	// Hosted, signed-in.
	if (session?.user) {
		return <>{children}</>;
	}

	// Hosted, signed-out → /login.
	const next = encodeURIComponent(location.pathname + location.search);
	return <Navigate to={`/login?next=${next}`} replace />;
}

function LoadingShell() {
	return (
		<div className="min-h-screen bg-gray-950 flex items-center justify-center">
			<div className="text-gray-400 text-sm font-mono">authenticating…</div>
		</div>
	);
}
