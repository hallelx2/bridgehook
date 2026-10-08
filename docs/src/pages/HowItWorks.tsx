import { ArchitectureDiagram, DataFlowDiagram } from "../components/FlowDiagram";

export function HowItWorks() {
	return (
		<>
			<h1>How It Works</h1>
			<p>
				Three parts: a relay in the cloud, a forwarder in your browser, and your local server. The
				relay accepts webhooks and queues them; the forwarder takes them off the queue and delivers
				them to localhost.
			</p>

			<h2>The pieces</h2>
			<ArchitectureDiagram />
			<ul>
				<li>
					<strong>Relay</strong>: a Cloudflare Worker with D1 for storage and Durable Objects for
					live wake-ups and sync waits. It never connects to your machine.
				</li>
				<li>
					<strong>Forwarder</strong>: the BridgeHook Chrome extension, or a dashboard tab in{" "}
					<a href="#/browser-bridge">no-install mode</a>. It is the only part that can reach
					localhost.
				</li>
				<li>
					<strong>Your server</strong>: whatever runs on the port, unchanged (no-install mode needs
					a CORS rule).
				</li>
			</ul>

			<h2>One webhook, step by step</h2>
			<DataFlowDiagram />

			<h3>1. A URL per port</h3>
			<p>
				Adding a port creates a channel owned by your account, with a 12-character id and its own
				host: <code>https://&lt;id&gt;.bridgehook.dev</code>. Adding the same port again, from the
				extension, a tab or an agent, returns the same channel, so the URL never changes.
			</p>

			<h3>2. The relay accepts and stores</h3>
			<p>
				A request to the URL is checked against the channel&apos;s path allowlist and your
				plan&apos;s limits, then stored in D1 with its method, path, headers and body. The path
				after the host is the path your server receives. In async mode the sender gets{" "}
				<code>202</code> with the event id right away.
			</p>

			<h3>3. The forwarder wakes</h3>
			<p>
				The relay notifies your dashboard and extension over a per-user SSE stream (
				<code>/api/me/stream</code>). Forwarders also poll, so nothing depends on that stream
				staying up: the dashboard tab every 2 seconds, the extension on a 30-second alarm.
			</p>

			<h3>4. Claim, forward, report</h3>
			<p>
				The forwarder reads the queue oldest first, <strong>claims</strong> an event so only one
				forwarder handles it, sends it to <code>http://localhost:&lt;port&gt;&lt;path&gt;</code>{" "}
				with the original method, headers and body, then reports your server&apos;s status, headers,
				body and latency. Claim and report requests are signed with the channel&apos;s key (
				<a href="#/channel-secrets">Channel Keys</a>).
			</p>

			<h3>5. The answer</h3>
			<p>
				The answer is stored with the event, so the dashboard and the MCP tools can show it. On a{" "}
				<a href="#/sync-responses">sync channel</a> the relay was holding the sender&apos;s request
				and returns the answer to it.
			</p>

			<h2>When nothing is forwarding</h2>
			<p>
				Steps 1 and 2 still happen. Events wait in the queue and are delivered in arrival order when
				a forwarder starts. Your plan sets how long event history is kept (see{" "}
				<a href="#/billing">Billing</a>).
			</p>
		</>
	);
}
