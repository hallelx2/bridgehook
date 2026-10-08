export function RelayAPI() {
	return (
		<>
			<h1>Relay API Reference</h1>
			<p>
				The relay server exposes the following HTTP endpoints. All responses are JSON with CORS
				headers.
			</p>

			<h2>Channels</h2>

			<h3>Create Channel</h3>
			<pre>
				<code>{`POST /api/channels
Content-Type: application/json

{
  "secretHash": "sha256-hex-string",
  "port": 3000,
  "allowedPaths": ["/webhook/stripe", "/webhook/github"]
}

→ 201 Created
{
  "channelId": "2324radf23r",
  "port": 3000,
  "expiresAt": "2026-04-10T22:30:34Z",
  "webhookUrl": "https://2324radf23r.bridgehook.dev"
}`}</code>
			</pre>

			<h3>Get Channel</h3>
			<pre>
				<code>{`GET /api/channels/:channelId

→ 200 OK
{
  "id": "2324radf23r",
  "port": 3000,
  "allowedPaths": ["/webhook/stripe"],
  "createdAt": "2026-04-09T22:30:34Z",
  "expiresAt": "2026-04-10T22:30:34Z",
  "webhookUrl": "https://2324radf23r.bridgehook.dev"
}`}</code>
			</pre>

			<h3>Delete Channel</h3>
			<pre>
				<code>{`DELETE /api/channels/:channelId

→ 200 OK
{ "deleted": true }`}</code>
			</pre>

			<h2>Events</h2>

			<h3>List Events</h3>
			<pre>
				<code>{`GET /api/channels/:channelId/events?limit=50

→ 200 OK
[
  {
    "id": "evt_abc123",
    "channelId": "2324radf23r",
    "method": "POST",
    "path": "/webhook/stripe",
    "requestHeaders": "{\\"content-type\\":\\"application/json\\"}",
    "requestBody": "{\\"type\\":\\"checkout.session.completed\\"}",
    "responseStatus": 200,
    "responseBody": "{\\"received\\":true}",
    "latencyMs": 12,
    "receivedAt": "2026-04-09T22:31:00Z"
  }
]`}</code>
			</pre>

			<h3>Delivery Queue</h3>
			<p>
				Unanswered events, oldest first, paged with an opaque cursor. Executors drain this on start,
				so webhooks that arrived while the browser was closed are delivered in order.
			</p>
			<pre>
				<code>{`GET /api/channels/:channelId/events?pending=1&limit=100&after=<cursor>

→ 200 OK
{
  "events": [ { "id": "evt_abc123", "method": "POST", "path": "/webhook/stripe", ... } ],
  "nextCursor": "eyJ0cyI6..."   // null when the queue is drained
}`}</code>
			</pre>

			<h2>Webhooks</h2>

			<h3>Receive Webhook (external senders hit this)</h3>
			<p>
				Every channel has its own host, <code>&lt;channelId&gt;.bridgehook.dev</code>. The path and
				query string are exactly what your local server receives. The relay host also accepts{" "}
				<code>/&lt;channelId&gt;[/path]</code> and <code>/hook/:channelId</code>, for URLs issued
				before channel hosts and for self-hosted relays without wildcard DNS.
			</p>
			<pre>
				<code>{`POST https://2324radf23r.bridgehook.dev/webhook/stripe
Content-Type: application/json

{ "type": "checkout.session.completed", ... }

→ 202 Accepted
{ "received": true, "eventId": "evt_abc123", "channelId": "2324radf23r" }

# forwarded to http://localhost:<port>/webhook/stripe
# accepted methods: POST, PUT, PATCH, DELETE`}</code>
			</pre>

			<h3>Sync response mode</h3>
			<p>
				By default a channel answers <code>202</code> at once and delivers in the background. Set{" "}
				<code>responseMode: "sync"</code> (on create, or <code>PATCH /api/me/channels/:id</code>)
				and the relay holds the request until an executor reports your local server&apos;s answer,
				then returns that status, headers and body to the sender. Use it for tool-call webhooks from
				voice and agent platforms and for GET verification challenges, which sync channels forward.
				If no answer arrives within <code>syncTimeoutMs</code> (milliseconds; rounded and clamped to
				1–100 s, default 25 s; a non-number is rejected with 400) the sender gets <code>504</code>{" "}
				and the event stays queued; if your server cannot be reached it gets <code>502</code>. Sync
				channels answer only on their own host (<code>&lt;id&gt;.bridgehook.dev</code>); the
				relay-host form returns <code>421</code>. Replies are served with{" "}
				<code>Content-Security-Policy: sandbox</code> and never set cookies.
			</p>
			<pre>
				<code>{`PATCH /api/me/channels/2324radf23r
{ "responseMode": "sync", "syncTimeoutMs": 20000 }

GET https://2324radf23r.bridgehook.dev/webhook?hub.mode=subscribe&hub.challenge=8231
→ 200 OK  "8231"            # your server's reply, returned to the sender
  X-BridgeHook-Event-Id: evt_abc123`}</code>
			</pre>

			<h3>Send Response (browser sends local response back)</h3>
			<pre>
				<code>{`POST /hook/:channelId/response
Content-Type: application/json

{
  "eventId": "evt_abc123",
  "status": 200,
  "headers": { "content-type": "application/json" },
  "body": "{\\"received\\": true}",
  "latencyMs": 12
}

→ 200 OK
{ "ok": true }`}</code>
			</pre>

			<h2>SSE Stream</h2>
			<pre>
				<code>{`GET /hook/:channelId/events
Accept: text/event-stream

→ 200 OK (text/event-stream, connection stays open)

data: {"type":"connected","channelId":"ch_9x4kf2m"}

data: {"type":"webhook","id":"evt_abc123","method":"POST",...}

data: {"type":"response","eventId":"evt_abc123","status":200,"latencyMs":12}`}</code>
			</pre>

			<h2>Rate Limits</h2>
			<table>
				<thead>
					<tr>
						<th>Limit</th>
						<th>Value</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Requests per minute per channel</td>
						<td>60</td>
					</tr>
					<tr>
						<td>Max body size</td>
						<td>1MB</td>
					</tr>
					<tr>
						<td>Max buffered events</td>
						<td>100</td>
					</tr>
					<tr>
						<td>Max SSE connections per channel</td>
						<td>5</td>
					</tr>
					<tr>
						<td>Channel lifetime</td>
						<td>24 hours</td>
					</tr>
				</tbody>
			</table>
		</>
	);
}
