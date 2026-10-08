/**
 * The apex (bridgehook.dev) serves the landing page; signing in and the
 * dashboard live on VITE_APP_URL, the origin the relay trusts with the
 * session cookie. Unset (self-host): one host serves everything.
 */

/** Routes that belong to the signed-in app, by prefix. */
const APP_ROUTE_PREFIXES = ["/login", "/auth", "/connect", "/dashboard"];

function appOrigin(): string | null {
	const raw = import.meta.env.VITE_APP_URL;
	if (!raw) return null;
	try {
		return new URL(raw).origin;
	} catch {
		// A malformed build setting must not take the landing page down.
		console.warn("VITE_APP_URL is not a valid URL; serving every route here");
		return null;
	}
}

/**
 * Where an app route served from the marketing host should go, or null to
 * render it here. Unknown paths stay, so the local catch-all handles them.
 */
export function appHostTarget(loc: { pathname: string; search: string; hash: string }):
	| string
	| null {
	const origin = appOrigin();
	if (!origin || window.location.origin === origin) return null;
	const path = loc.pathname.replace(/\/+$/, "") || "/";
	const isApp = APP_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
	return isApp ? `${origin}${loc.pathname}${loc.search}${loc.hash}` : null;
}
