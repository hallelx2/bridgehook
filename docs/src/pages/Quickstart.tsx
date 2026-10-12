import { Callout, StepTimeline } from "../components/Illustrations";

export function Quickstart() {
	return (
		<>
			<h1>Quickstart</h1>
			<p>Get a permanent webhook URL for a local port and see the first webhook arrive.</p>

			<h2>With the extension (recommended)</h2>
			<StepTimeline
				steps={[
					{
						title: "Install the extension",
						desc: "Add BridgeHook from the Chrome Web Store and sign in from its popup.",
						code: "chromewebstore.google.com/detail/gfblggfnemgdflgpkoieddinpoodmppg",
						color: "#FF5C26",
					},
					{
						title: "Add your port",
						desc: "Enter the port your dev server listens on and the path prefix to forward. Use / to forward every path.",
						code: "Port 3000 · Path /api/webhooks",
						color: "#FF8A5C",
					},
					{
						title: "Copy the URL",
						desc: "The same port keeps the same URL across restarts. Register it with your provider once.",
						code: "https://8f3a2c1d9e4b.bridgehook.dev",
						color: "#FF5C26",
					},
					{
						title: "Watch it arrive",
						desc: "Each webhook goes to your server and its answer is recorded in the dashboard.",
						code: "POST /api/webhooks/stripe → 200 (12 ms)",
						color: "#28c840",
					},
				]}
			/>
			<p>
				The extension needs no CORS changes on your server and keeps forwarding from any tab while
				Chrome is open.
			</p>

			<h2>From the terminal (CLI)</h2>
			<p>
				For servers, containers and anyone who lives in a terminal. One line installs the{" "}
				<code>bridgehook</code> binary (macOS, Linux; x86_64 and arm64):
			</p>
			<pre>
				<code>curl -fsSL https://bridgehook.dev/install.sh | sh</code>
			</pre>
			<p>On Windows, in PowerShell:</p>
			<pre>
				<code>irm https://bridgehook.dev/install.ps1 | iex</code>
			</pre>
			<p>
				Both check that the download is intact against the release&apos;s SHA-256 checksums and
				install nothing if it does not match. Re-run either line to upgrade; set{" "}
				<code>BRIDGEHOOK_VERSION</code> to install a specific version. Then pair the machine and
				forward a port:
			</p>
			<pre>
				<code>{`bridgehook login          # approve the code in your browser
bridgehook forward 3000   # prints https://<id>.bridgehook.dev`}</code>
			</pre>
			<p>
				<code>forward</code> keeps the same URL for the same port across restarts, delivers webhooks
				that arrived while it was stopped in order, and prints each one as it goes to your server.
				Add <code>--json</code> for one JSON object per line, or <code>--path /stripe</code> to
				accept only that path. Where you cannot open a browser (a container, CI), set{" "}
				<code>BRIDGEHOOK_TOKEN</code> to a device token: the <code>token</code> field of{" "}
				<code>~/.config/bridgehook/token.json</code> on a machine you paired, which you can revoke
				from the dashboard's device list.
			</p>

			<h2>With nothing installed</h2>
			<p>
				Open{" "}
				<a href="https://app.bridgehook.dev/dashboard/bridge" target="_blank" rel="noreferrer">
					Dashboard → Browser bridge
				</a>
				, enter your port and press <b>Start bridge</b>. That tab is now the forwarder. Because a
				web page can only read a localhost reply your server allows, add one CORS rule for{" "}
				<code>https://app.bridgehook.dev</code>; the dashboard shows the exact line for Express,
				Hono, Next.js, FastAPI, Flask, Django, Rails and Go when it detects the block. Details in{" "}
				<a href="#/browser-bridge">No-install mode</a>.
			</p>

			<h2>From a coding agent</h2>
			<p>
				Mint an agent token under <b>Dashboard → AI agents</b> and add the MCP server to your agent.
				The agent can then create the URL itself and test your handler. See{" "}
				<a href="#/ai-agents">AI agents (MCP)</a>.
			</p>

			<h2>Send a test webhook</h2>
			<pre>
				<code>{`curl -X POST https://8f3a2c1d9e4b.bridgehook.dev/api/webhooks/test \\
  -H "Content-Type: application/json" \\
  -d '{"event": "checkout.session.completed"}'`}</code>
			</pre>
			<p>
				The path after the host is the path your server receives. The reply is <code>202</code> with
				an event id; in <a href="#/sync-responses">sync mode</a> it is your server&apos;s own
				answer.
			</p>

			<Callout icon="📥" title="Nothing running? Nothing lost." color="#FF5C26">
				If nothing is forwarding (no extension, CLI or dashboard tab), webhooks are stored and
				delivered in arrival order when one starts. How long history is kept depends on your plan;
				see <a href="#/billing">Billing</a>.
			</Callout>
		</>
	);
}
