export function SSEEvents() {
	return (
		<>
			<h1>SSE Event Types</h1>
			<p>The relay pushes three types of events through the SSE stream.</p>

			<h2>Connected</h2>
			<p>Sent immediately when the SSE connection is established.</p>
			<pre>
				<code>{`{
  "type": "connected",
  "channelId": "ch_9x4kf2m"
}`}</code>
			</pre>

			<h2>Webhook</h2>
			<p>Sent when an external service (Stripe, GitHub, etc.) POSTs to your webhook URL.</p>
			<pre>
				<code>{`{
  "type": "webhook",
  "id": "evt_abc123",
  "channelId": "ch_9x4kf2m",
  "method": "POST",
  "path": "/hook/ch_9x4kf2m",
  "headers": {
    "content-type": "application/json",
    "stripe-signature": "t=1234..."
  },
  "body": "{\\"type\\":\\"checkout.session.completed\\"}",
  "receivedAt": "2026-04-09T22:31:00Z"
}`}</code>
			</pre>

			<h2>Response</h2>
			<p>Sent when a browser sends back the local server's response, confirming the round-trip.</p>
			<pre>
				<code>{`{
  "type": "response",
  "eventId": "evt_abc123",
  "status": 200,
  "latencyMs": 12
}`}</code>
			</pre>

			<h2>Handling Events</h2>
			<pre>
				<code>{`const source = new EventSource(\`\${relayUrl}/hook/\${channelId}/events\`);

source.onmessage = (msg) => {
  const event = JSON.parse(msg.data);

  switch (event.type) {
    case "connected":
      console.log("Bridge connected to channel", event.channelId);
      break;

    case "webhook":
      // Forward to localhost
      forwardToLocalhost(event);
      break;

    case "response":
      // Update UI with response status
      updateEventStatus(event.eventId, event.status, event.latencyMs);
      break;
  }
};`}</code>
			</pre>
		</>
	);
}
