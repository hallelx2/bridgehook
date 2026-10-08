import { Callout, ProtocolCompare } from "../components/Illustrations";

export function SSETechnology() {
	return (
		<>
			<h1>Live updates (SSE)</h1>
			<p>
				BridgeHook pushes &quot;something changed&quot; to your browser with Server-Sent Events, the
				same one-way HTTP stream used for streamed LLM output. The stream only wakes things up: the
				webhook itself is always read from the queue, so a dropped stream delays delivery by a few
				seconds and never loses an event.
			</p>

			<h2>The per-user stream</h2>
			<pre>
				<code>{`GET https://relay.bridgehook.dev/api/me/stream     (session cookie)
Content-Type: text/event-stream

data: {"type":"webhook","id":"…","channelId":"2324radf23r","method":"POST","path":"/api/webhooks/stripe","headers":{…},"body":"…","receivedAt":"…"}

data: {"type":"claimed","eventId":"…","channelId":"2324radf23r","claimerId":"…","claimedAt":"…"}

data: {"type":"response","eventId":"…","channelId":"2324radf23r","status":200,"latencyMs":12}`}</code>
			</pre>
			<p>
				One stream per signed-in user carries events for all of their channels. It is held by a
				Durable Object per user, so a webhook that lands on any channel fans out to every open
				dashboard page and the extension at once.
			</p>
			<ul>
				<li>
					<strong>Dashboard pages</strong> (Overview, Events, Channels) update live from it.
				</li>
				<li>
					<strong>The extension</strong> uses it while you are signed in with a browser session, and
					polls on a 30-second alarm in device-token mode, which has no cookie.
				</li>
				<li>
					<strong>The no-install tab</strong> polls its channel every 2 seconds and drains the queue
					on each new event.
				</li>
			</ul>

			<h2>Why SSE and not WebSocket</h2>
			<ProtocolCompare />
			<p>
				The relay only needs to push; answers go back as ordinary signed <code>POST</code>s. SSE is
				plain HTTP, reconnects on its own and passes through proxies and CDNs that block WebSocket
				upgrades.
			</p>

			<Callout icon="🧠" title="Why the queue matters more than the stream" color="#FF5C26">
				Streams drop: laptops sleep, service workers are stopped, networks change. Because delivery
				reads <code>GET /api/channels/:id/events?pending=1</code> and claims each event, a forwarder
				that reconnects after an hour picks up exactly where it left off, in order.
			</Callout>
		</>
	);
}
