export function SSEEvents() {
	return (
		<>
			<h1>SSE Events</h1>
			<p>
				<code>GET /api/me/stream</code> is a per-user Server-Sent Events stream covering all of your
				channels. It needs the session cookie. Frames are JSON in <code>data:</code> lines, and a
				comment frame every 20 seconds keeps the connection open.
			</p>

			<h2>connected</h2>
			<p>Sent once when the stream opens.</p>
			<pre>
				<code>{`{ "type": "connected" }`}</code>
			</pre>

			<h2>webhook</h2>
			<p>A webhook arrived on one of your channels, or a replay was queued.</p>
			<pre>
				<code>{`{
  "type": "webhook",
  "id": "…",
  "channelId": "2324radf23r",
  "method": "POST",
  "path": "/api/webhooks/stripe",
  "headers": { "content-type": "application/json", "stripe-signature": "t=…,v1=…" },
  "body": "{\\"type\\":\\"checkout.session.completed\\"}",
  "receivedAt": "2026-10-08T09:31:00.000Z"
}`}</code>
			</pre>

			<h2>claimed</h2>
			<p>A forwarder claimed an event and is delivering it.</p>
			<pre>
				<code>{`{ "type": "claimed", "eventId": "…", "channelId": "2324radf23r",
  "claimerId": "web_…", "claimedAt": "…" }`}</code>
			</pre>

			<h2>response</h2>
			<p>Your server&apos;s answer was reported.</p>
			<pre>
				<code>{`{ "type": "response", "eventId": "…", "channelId": "2324radf23r",
  "status": 200, "latencyMs": 12 }`}</code>
			</pre>

			<h2>Using it</h2>
			<pre>
				<code>{`const source = new EventSource("https://relay.bridgehook.dev/api/me/stream", {
  withCredentials: true,
});

source.onmessage = (msg) => {
  const event = JSON.parse(msg.data);
  if (event.type === "webhook") drainQueue(event.channelId);   // read ?pending=1, claim, forward
  if (event.type === "response") markAnswered(event.eventId, event.status);
};`}</code>
			</pre>
			<p>
				Treat a <code>webhook</code> frame as a signal to read the delivery queue, not as the work
				itself: the queue is ordered and survives disconnects, the stream does not. Device-token
				clients (the extension without a browser session) cannot open this stream and poll instead.
			</p>
		</>
	);
}
