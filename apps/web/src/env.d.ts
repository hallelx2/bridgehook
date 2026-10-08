/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_RELAY_URL: string;
	/**
	 * Origin that serves the signed-in app (e.g. https://app.bridgehook.dev).
	 * When set and the page is served from another host (the marketing apex),
	 * account routes move to this origin. Unset: one host serves everything.
	 */
	readonly VITE_APP_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
