import { magicLinkClient } from "better-auth/client/plugins";
/**
 * Better-Auth client. Talks to the relay's /auth/** endpoints.
 *
 * In self-host mode the relay returns 404 on /auth/** routes; we never
 * call this client there (the AuthGate becomes a passthrough). The lib
 * import is harmless if unused.
 *
 * The opaque `AuthClient` type below is a deliberate workaround for
 * Better-Auth's deep generic inference that TypeScript can't serialize
 * across module boundaries (TS2742). We only call a small surface, so
 * we declare just that surface here.
 */
import { createAuthClient } from "better-auth/react";

const RELAY_URL = import.meta.env.VITE_RELAY_URL || "http://localhost:8787";

interface SessionUser {
	id: string;
	email: string;
	name: string;
	emailVerified: boolean;
	image?: string | null;
}

interface SessionData {
	user: SessionUser;
	session: { id: string; userId: string; expiresAt: Date };
}

interface AuthClient {
	signIn: {
		magicLink: (args: {
			email: string;
			callbackURL?: string;
			newUserCallbackURL?: string;
		}) => Promise<{ data?: unknown; error?: { message?: string } }>;
		/**
		 * OAuth sign-in. Provider name matches the key in the relay's
		 * `socialProviders` config — currently "google" or "github".
		 * Better-Auth redirects the browser to the provider's authorize URL;
		 * `callbackURL` is where the user lands after the OAuth dance completes.
		 */
		social: (args: {
			provider: "google" | "github";
			callbackURL?: string;
		}) => Promise<{ data?: unknown; error?: { message?: string } }>;
	};
	signOut: () => Promise<{ data?: unknown; error?: { message?: string } }>;
	useSession: () => {
		data: SessionData | null;
		isPending: boolean;
		error: Error | null;
	};
	getSession: () => Promise<{ data: SessionData | null; error: Error | null }>;
}

const _client = createAuthClient({
	baseURL: RELAY_URL,
	basePath: "/auth",
	fetchOptions: {
		// Required for cross-subdomain session cookies (app.bridgehook.dev →
		// relay.bridgehook.dev). The relay's CORS already echoes the origin
		// and sets Allow-Credentials.
		credentials: "include",
	},
	plugins: [magicLinkClient()],
});

export const authClient = _client as unknown as AuthClient;

export const { signIn, signOut, useSession } = authClient;
