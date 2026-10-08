import { Callout, StepTimeline } from "../components/Illustrations";

export function Introduction() {
	return (
		<>
			<h1>Introduction</h1>
			<p>
				<strong>
					BridgeHook is webhook testing for apps built with AI, and for the agents building them.
				</strong>{" "}
				Every local port gets a permanent public URL. Webhooks sent to it reach the server on your
				machine through your browser, with no tunnel binary and no terminal. When your machine is
				off they wait in a queue and arrive in order once it is back.
			</p>

			<Callout icon="🌉" title="The idea" color="#FF5C26">
				Your browser already runs on your machine and can reach <code>localhost</code>. BridgeHook
				uses it as the forwarder: the relay receives the webhook, and the BridgeHook extension (or a
				dashboard tab) sends it to your local server and returns the answer.
			</Callout>

			<h2>What you can build with it</h2>
			<ul>
				<li>
					<strong>Coding agents that test their own webhook handlers.</strong> BridgeHook is a
					remote MCP server. Claude Code, Cursor, VS Code or Codex can create a URL for a port, fire
					a signed Stripe, GitHub, OpenAI, ElevenLabs or Vapi webhook at your real handler, read
					exactly what it answered, fix the code and replay. See{" "}
					<a href="#/ai-agents">AI agents (MCP)</a>.
				</li>
				<li>
					<strong>Voice and agent tools that need an answer.</strong> In sync mode the sender gets
					your local server&apos;s reply, so Vapi and ElevenLabs tool calls and GET verification
					challenges work against code on your laptop. See{" "}
					<a href="#/sync-responses">Sync responses</a>.
				</li>
				<li>
					<strong>Background webhooks from AI APIs.</strong> OpenAI batch and background-response
					webhooks, ElevenLabs post-call transcripts and Stripe events can arrive hours later. The
					URL never changes, and anything sent while you were away is delivered in order.
				</li>
			</ul>

			<h2>How it works in 30 seconds</h2>
			<StepTimeline
				steps={[
					{
						title: "Sign in",
						desc: "Install the Chrome extension, or open the dashboard's browser bridge with nothing installed.",
						code: "app.bridgehook.dev",
						color: "#FF5C26",
					},
					{
						title: "Add your port",
						desc: "The port your local server listens on, and optionally the paths to allow.",
						code: "localhost:3000",
						color: "#FF8A5C",
					},
					{
						title: "Copy the URL",
						desc: "The same port always gets the same URL. Paste it into Stripe, OpenAI, Vapi or any provider once.",
						code: "https://8f3a2c1d9e4b.bridgehook.dev",
						color: "#FF5C26",
					},
					{
						title: "Webhooks reach localhost",
						desc: "Each one is forwarded to your server and its answer is recorded, or returned to the sender in sync mode.",
						code: "POST /api/webhooks/stripe → 200 (12 ms)",
						color: "#28c840",
					},
				]}
			/>

			<h2>Three ways to forward</h2>
			<table>
				<thead>
					<tr>
						<th>Executor</th>
						<th>Install</th>
						<th>Needs CORS on your server</th>
						<th>Runs while</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<a
								href="https://chromewebstore.google.com/detail/gfblggfnemgdflgpkoieddinpoodmppg"
								target="_blank"
								rel="noreferrer"
							>
								Chrome extension
							</a>
						</td>
						<td>From the Chrome Web Store</td>
						<td>No</td>
						<td>Chrome is open, any tab</td>
					</tr>
					<tr>
						<td>
							<a href="#/browser-bridge">Dashboard tab</a> (no-install mode)
						</td>
						<td>Nothing</td>
						<td>Yes (one line, we show it for your framework)</td>
						<td>The tab is open</td>
					</tr>
					<tr>
						<td>
							<a href="#/self-hosting">Self-hosted relay</a>
						</td>
						<td>Your own Cloudflare account</td>
						<td>Same as above</td>
						<td>Same as above</td>
					</tr>
				</tbody>
			</table>
			<p>
				With no executor running, webhooks are stored and the sender gets <code>202</code> at once
				(or, in sync mode, <code>504</code> after the timeout). They are forwarded in arrival order
				as soon as an executor comes back.
			</p>

			<h2>What you get</h2>
			<ul>
				<li>
					A permanent URL per port, at its own host: <code>&lt;id&gt;.bridgehook.dev</code>
				</li>
				<li>Ordered delivery of webhooks that arrived while nothing was forwarding</li>
				<li>Sync mode: your server&apos;s status, headers and body go back to the sender</li>
				<li>A remote MCP server with eight tools for coding agents</li>
				<li>Event history with request and response headers, bodies and latency</li>
				<li>
					<strong>Replay</strong> any event, or <strong>edit and replay</strong> it
				</li>
				<li>Signature verification in the dashboard for Stripe, GitHub and Shopify</li>
				<li>Mock responses, copy as cURL, a command palette (⌘K)</li>
				<li>A path allowlist, so only the routes you choose are forwarded</li>
			</ul>

			<h2>Prior art</h2>
			<p>
				SSE webhook relays go back to{" "}
				<a href="https://smee.io" target="_blank" rel="noreferrer">
					smee.io
				</a>{" "}
				in 2017, and several services now expose webhook inboxes to agents over MCP. BridgeHook
				closes the loop through <em>your</em> running handler: the agent sees the status, body and
				error your code produced, not just the payload that arrived.
			</p>

			<Callout icon="🛠️" title="Open source" color="#28c840">
				The relay, dashboard and extension are in one MIT-licensed repository, and the hosted
				service runs the same code you can <a href="#/self-hosting">self-host</a> on Cloudflare
				Workers, Durable Objects and D1.
			</Callout>
		</>
	);
}
