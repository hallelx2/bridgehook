import { Callout } from "../components/Illustrations";

export function SyncResponses() {
	return (
		<>
			<h1>Sync responses</h1>
			<p>
				Most webhooks only need a <code>2xx</code>, and by default a BridgeHook URL answers{" "}
				<code>202</code> at once and delivers in the background. Some senders need your
				server&apos;s actual reply: a voice agent waiting for a tool result, an ElevenLabs server
				tool, a provider checking your endpoint with a GET challenge. For those, switch the channel
				to <strong>sync</strong>.
			</p>

			<h2>What changes</h2>
			<ol>
				<li>The relay holds the sender&apos;s request open.</li>
				<li>Your forwarder (extension or dashboard tab) delivers it to localhost.</li>
				<li>
					Your server&apos;s status, headers and body are returned to the sender, with an{" "}
					<code>X-BridgeHook-Event-Id</code> header added.
				</li>
			</ol>
			<table>
				<thead>
					<tr>
						<th>Outcome</th>
						<th>The sender gets</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Your server answered</td>
						<td>Your status, headers and body</td>
					</tr>
					<tr>
						<td>No answer within the sync timeout</td>
						<td>
							<code>504</code>. The event stays queued and is still delivered later.
						</td>
					</tr>
					<tr>
						<td>Your server could not be reached</td>
						<td>
							<code>502</code>
						</td>
					</tr>
				</tbody>
			</table>
			<p>
				The timeout is per channel, from 1 to 100 seconds (25 by default). Set it shorter than the
				sender&apos;s own deadline so it gets a clean <code>504</code> rather than giving up on its
				side.
			</p>

			<h2>Turn it on</h2>
			<ul>
				<li>
					<b>Dashboard → Channels</b>: set the Reply column to <b>Your server&apos;s reply</b> and
					pick a timeout.
				</li>
				<li>
					<b>From a coding agent</b>: <code>set_response_mode</code> with{" "}
					<code>reply_mode: "sync"</code>, or <code>create_webhook_url</code> with the same option.
				</li>
				<li>
					<b>API</b>:
				</li>
			</ul>
			<pre>
				<code>{`PATCH /api/me/channels/8f3a2c1d9e4b
{ "responseMode": "sync", "syncTimeoutMs": 20000 }`}</code>
			</pre>

			<h2>Verification challenges</h2>
			<p>
				Sync channels also forward <code>GET</code> and <code>HEAD</code>, so a provider that
				verifies an endpoint by sending a challenge and expecting it echoed gets your server&apos;s
				echo:
			</p>
			<pre>
				<code>{`GET https://8f3a2c1d9e4b.bridgehook.dev/webhook?hub.mode=subscribe&hub.challenge=8231
→ 200  "8231"`}</code>
			</pre>

			<h2>Safety</h2>
			<p>
				A sync reply is content from your server shown at a public URL, so the relay constrains it:
			</p>
			<ul>
				<li>
					Replies are served only on the channel&apos;s own host (
					<code>&lt;id&gt;.bridgehook.dev</code>
					). The relay host answers <code>421</code> for sync channels.
				</li>
				<li>
					Every reply carries <code>Content-Security-Policy: sandbox</code> and{" "}
					<code>X-Content-Type-Options: nosniff</code>.
				</li>
				<li>
					<code>Set-Cookie</code> is dropped, and BridgeHook&apos;s own session cookies are never
					forwarded to your server.
				</li>
			</ul>

			<Callout icon="🎙️" title="Latency budget" color="#FF8A5C">
				A sync round trip is the sender reaching Cloudflare, your browser reaching localhost, and
				your handler. Vapi, for example, allows 7.5 seconds for <code>assistant-request</code>. Keep
				tool handlers quick and return early from slow work.
			</Callout>
		</>
	);
}
