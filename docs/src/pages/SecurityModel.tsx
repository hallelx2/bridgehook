import { Callout, SecurityLayers } from "../components/Illustrations";

export function SecurityModel() {
	return (
		<>
			<h1>Security Model</h1>
			<p>
				A webhook URL is meant to be public: you paste it into Stripe, OpenAI or Vapi. This page is
				about what that exposes and what it does not.
			</p>

			<Callout icon="🔒" title="Key principle" color="#9093ff">
				<strong>The relay never connects to your machine.</strong> It stores events. Only a
				forwarder you run (the extension or a dashboard tab) can reach localhost, and only for the
				port you gave it.
			</Callout>

			<h2>What someone with your URL can do</h2>
			<ul>
				<li>Send requests to allowed paths. They are stored and forwarded like any webhook.</li>
				<li>Use up your plan&apos;s daily event cap by flooding it.</li>
				<li>
					Read the channel&apos;s public settings from <code>GET /api/channels/:id</code>: its port,
					allowed paths and reply mode. No events, keys or account details.
				</li>
				<li>
					On a <a href="#/sync-responses">sync channel</a>, see whatever your server answers to
					those requests, because the reply goes back to the sender. Verify signatures before acting
					or returning data.
				</li>
			</ul>
			<h2>What they cannot do</h2>
			<ul>
				<li>
					Read your event history, other senders&apos; payloads, or your server&apos;s replies on an
					async channel.
				</li>
				<li>Reach a path outside the allowlist: the relay answers 403 and stores nothing.</li>
				<li>
					Claim events or report answers: those requests must be signed with the channel&apos;s key.
				</li>
				<li>Reach any other port or host on your machine.</li>
				<li>
					Receive cookies: sync replies drop <code>Set-Cookie</code>.
				</li>
			</ul>

			<h2>Layers</h2>
			<SecurityLayers />

			<h2>Threats</h2>
			<table>
				<thead>
					<tr>
						<th>Threat</th>
						<th>Mitigation</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Forged webhooks</td>
						<td>
							Verify the provider&apos;s signature in your handler (see the provider guides).
							BridgeHook forwards bodies and signature headers unchanged so verification works.
						</td>
					</tr>
					<tr>
						<td>
							Probing for <code>/admin</code> and friends
						</td>
						<td>Path allowlist, enforced by the relay before storage</td>
					</tr>
					<tr>
						<td>Another forwarder taking over your channel</td>
						<td>
							Channel requests are signed with an ECDSA key that only your browser holds; rotating
							it requires your signed-in account
						</td>
					</tr>
					<tr>
						<td>A sync reply used as a phishing page on our domain</td>
						<td>
							Served only on <code>&lt;id&gt;.bridgehook.dev</code>, never the API host, with{" "}
							<code>Content-Security-Policy: sandbox</code> and <code>nosniff</code>
						</td>
					</tr>
					<tr>
						<td>Your BridgeHook session leaking to your server</td>
						<td>BridgeHook&apos;s own cookies are stripped from forwarded requests</td>
					</tr>
					<tr>
						<td>An agent token misused</td>
						<td>
							Agent tokens work only on <code>/mcp</code>, cannot create forwarding channels or
							rotate keys, and are revocable from the dashboard
						</td>
					</tr>
					<tr>
						<td>Oversized or abusive traffic</td>
						<td>
							1 MB bodies, 32 KB headers, a daily event cap per plan, rate-limited channel creation
						</td>
					</tr>
				</tbody>
			</table>

			<h2>Data you send through BridgeHook</h2>
			<p>
				Webhook requests and your server&apos;s replies are stored so you can inspect and replay
				them, for as long as your plan&apos;s retention. Treat them like logs: use test-mode
				providers, and do not route production customer traffic through a development URL.
			</p>
		</>
	);
}
