/**
 * Generate a bash-friendly cURL command that reproduces an event.
 *
 * The reproduction target is the *relay webhook URL* — firing this curl
 * will re-inject the exact request as if the original provider sent it,
 * which triggers the browser's forwarding pipeline normally.
 */

interface CurlInput {
	method: string;
	path: string; // relay path, e.g. /hook/ch_abc/webhook/stripe
	requestHeaders: Record<string, string>;
	requestBody: string | null;
}

// Headers that Cloudflare / the relay inject and that shouldn't be echoed back
// by the user's manual curl command — they'd be overridden anyway.
const CURL_SKIP_HEADERS = new Set([
	"host",
	"content-length",
	"cf-ray",
	"cf-connecting-ip",
	"cf-ipcountry",
	"cf-visitor",
	"x-real-ip",
	"x-forwarded-proto",
	"x-forwarded-for",
	"connection",
	"accept-encoding",
]);

function shellEscape(value: string): string {
	// Single-quote wrap with embedded-single-quote handling: a'b → 'a'\''b'
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export function toCurl(event: CurlInput, relayBaseUrl: string): string {
	const url = `${relayBaseUrl.replace(/\/$/, "")}${event.path}`;
	const lines: string[] = [`curl -X ${event.method.toUpperCase()} ${shellEscape(url)}`];

	for (const [k, v] of Object.entries(event.requestHeaders)) {
		if (CURL_SKIP_HEADERS.has(k.toLowerCase())) continue;
		lines.push(`  -H ${shellEscape(`${k}: ${v}`)}`);
	}

	if (event.requestBody) {
		lines.push(`  --data-raw ${shellEscape(event.requestBody)}`);
	}

	return lines.join(" \\\n");
}
