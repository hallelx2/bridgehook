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
						code: "https://2324radf23r.bridgehook.dev",
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
				<code>{`curl -X POST https://2324radf23r.bridgehook.dev/api/webhooks/test \\
  -H "Content-Type: application/json" \\
  -d '{"event": "checkout.session.completed"}'`}</code>
			</pre>
			<p>
				The path after the host is the path your server receives. The reply is <code>202</code> with
				an event id; in <a href="#/sync-responses">sync mode</a> it is your server&apos;s own
				answer.
			</p>

			<Callout icon="📥" title="Nothing running? Nothing lost." color="#FF5C26">
				If neither the extension nor a dashboard tab is forwarding, webhooks are stored and
				delivered in arrival order when one starts. How long history is kept depends on your plan;
				see <a href="#/billing">Billing</a>.
			</Callout>
		</>
	);
}
