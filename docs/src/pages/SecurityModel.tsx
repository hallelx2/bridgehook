import { Callout, SecurityLayers } from "../components/Illustrations";

export function SecurityModel() {
	return (
		<>
			<h1>Security Model</h1>
			<p>
				The webhook URL is semi-public — you paste it into Stripe, GitHub, etc. Here's why that's safe and what protections are in place.
			</p>

			<Callout icon="🔒" title="Key Principle" color="#9093ff">
				<strong>The relay is a dumb pipe. The browser is the smart gatekeeper.</strong> The relay server never touches your machine.
				It only holds events in a mailbox. Your browser decides what reaches localhost. All security decisions happen client-side.
			</Callout>

			<h2>What an Attacker Can and Cannot Do</h2>
			<p><strong>With just the webhook URL:</strong></p>
			<ul>
				<li>Can send fake webhooks to the relay (they get buffered)</li>
				<li>Cannot read any responses from your server</li>
				<li>Cannot connect to your SSE stream</li>
				<li>Cannot reach your localhost — the browser hasn't forwarded it</li>
				<li>Cannot open paths you haven't allowed — the browser filters them</li>
			</ul>

			<p><strong>With physical access to your browser tab:</strong></p>
			<ul>
				<li>They already have access to your machine — the webhook bridge is the least of your concerns</li>
				<li>Close the tab = instant kill switch, bridge dies immediately</li>
			</ul>

			<h2>Five Security Layers</h2>
			<SecurityLayers />

			<h2>Threat Model Summary</h2>
			<table>
				<thead>
					<tr><th>Threat</th><th>Mitigated By</th></tr>
				</thead>
				<tbody>
					<tr><td>Someone finds your webhook URL</td><td>They can only send events, not read responses or connect SSE</td></tr>
					<tr><td>Malicious webhook targets /admin</td><td>Path allowlist blocks it in the browser — never reaches localhost</td></tr>
					<tr><td>Channel hijacking</td><td>Channel IDs are 128-bit random, unguessable</td></tr>
					<tr><td>Relay compromise</td><td>Relay only has hashed secrets; can't impersonate your browser</td></tr>
					<tr><td>Stale channels</td><td>Auto-expire after 24 hours, no permanent attack surface</td></tr>
					<tr><td>DDoS via webhooks</td><td>Rate limiting: 60 req/min, 1MB max, 100 event buffer</td></tr>
				</tbody>
			</table>

			<Callout icon="⚡" title="Kill Switch" color="#fcd34d">
				Close the browser tab and the bridge dies instantly. The SSE connection closes,
				forwarding stops, and no more events reach localhost. There are no zombie processes,
				no background daemons, no residual network tunnels.
			</Callout>
		</>
	);
}
