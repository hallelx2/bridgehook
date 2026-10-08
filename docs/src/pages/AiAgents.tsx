import { Callout } from "../components/Illustrations";

export function AiAgents() {
	return (
		<>
			<h1>AI agents (MCP)</h1>
			<p>
				BridgeHook is a remote MCP server, so a coding agent such as Claude Code, Cursor, VS Code or
				Codex can build and debug webhook handlers against your real local server. The agent gets a
				permanent webhook URL for a port, fires a realistic provider webhook at it, reads exactly
				what your handler answered, and replays it after fixing the code. There is nothing to
				install.
			</p>

			<Callout icon="🔌" title="Endpoint" color="#ff8a5c">
				<code>https://relay.bridgehook.dev/mcp</code> (Streamable HTTP). Authenticate with an agent
				token from <b>Dashboard → AI agents</b>, sent as <code>Authorization: Bearer dvc_…</code>.
				Agent tokens only work with the MCP server, do not count toward your device limit, and can
				be revoked at any time.
			</Callout>

			<h2>Connect</h2>
			<h3>Claude Code</h3>
			<pre>
				<code>{`claude mcp add --transport http bridgehook https://relay.bridgehook.dev/mcp \\
  --header "Authorization: Bearer dvc_…"`}</code>
			</pre>
			<h3>Cursor (~/.cursor/mcp.json)</h3>
			<pre>
				<code>{`{ "mcpServers": { "bridgehook": {
  "url": "https://relay.bridgehook.dev/mcp",
  "headers": { "Authorization": "Bearer dvc_…" } } } }`}</code>
			</pre>
			<h3>VS Code (.vscode/mcp.json)</h3>
			<pre>
				<code>{`{ "servers": { "bridgehook": {
  "type": "http",
  "url": "https://relay.bridgehook.dev/mcp",
  "headers": { "Authorization": "Bearer dvc_…" } } } }`}</code>
			</pre>
			<h3>Codex (~/.codex/config.toml)</h3>
			<pre>
				<code>{`[mcp_servers.bridgehook]
url = "https://relay.bridgehook.dev/mcp"
bearer_token_env_var = "BRIDGEHOOK_TOKEN"   # export BRIDGEHOOK_TOKEN=dvc_…`}</code>
			</pre>

			<h2>Tools</h2>
			<table>
				<thead>
					<tr>
						<th>Tool</th>
						<th>What it does</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>create_webhook_url</code>
						</td>
						<td>
							Permanent URL for a local port (the same port always gets the same URL); optional
							reply mode.
						</td>
					</tr>
					<tr>
						<td>
							<code>send_test_event</code>
						</td>
						<td>
							Realistic Stripe, GitHub, OpenAI, ElevenLabs, Vapi or generic webhook, signed like the
							provider when you pass the endpoint secret, then waits for your handler&apos;s answer.
						</td>
					</tr>
					<tr>
						<td>
							<code>wait_for_webhook</code>
						</td>
						<td>
							Blocks until a real webhook matching filters arrives, optionally until it is answered.
						</td>
					</tr>
					<tr>
						<td>
							<code>get_event</code>
						</td>
						<td>Full request plus your handler&apos;s status, headers, body, latency and error.</td>
					</tr>
					<tr>
						<td>
							<code>replay_event</code>
						</td>
						<td>Send an earlier webhook again (optionally edited) and return the new answer.</td>
					</tr>
					<tr>
						<td>
							<code>list_events</code>, <code>list_webhook_urls</code>
						</td>
						<td>History and channels.</td>
					</tr>
					<tr>
						<td>
							<code>set_response_mode</code>
						</td>
						<td>
							<code>sync</code> returns your handler&apos;s reply to the sender, for Vapi and
							ElevenLabs tool calls and GET verification challenges.
						</td>
					</tr>
				</tbody>
			</table>

			<h2>How forwarding happens</h2>
			<p>
				Webhooks reach localhost through the BridgeHook Chrome extension. A URL created by an agent
				is picked up the moment you add the same port in the extension, which keeps the URL.
				Webhooks that arrive before then, or while your machine is off, are queued and delivered in
				order.
			</p>

			<h2>Example prompt</h2>
			<pre>
				<code>
					Use BridgeHook to send a signed Stripe checkout.session.completed to my app on port 3000
					at /api/webhooks/stripe (secret whsec_…), then fix whatever the handler gets wrong and
					replay until it returns 200.
				</code>
			</pre>
		</>
	);
}
