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
  "channelId": "ch_9x4kf2m",
  "port": 3000,
  "expiresAt": "2026-04-10T22:30:34Z",
  "webhookUrl": "https://relay.bridgehook.dev/hook/ch_9x4kf2m"
}`}</code>
			</pre>

			<h3>Get Channel</h3>
			<pre>
				<code>{`GET /api/channels/:channelId

→ 200 OK
{
  "id": "ch_9x4kf2m",
  "port": 3000,
  "allowedPaths": ["/webhook/stripe"],
  "createdAt": "2026-04-09T22:30:34Z",
  "expiresAt": "2026-04-10T22:30:34Z",
  "webhookUrl": "https://relay.bridgehook.dev/hook/ch_9x4kf2m"
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
    "channelId": "ch_9x4kf2m",
    "method": "POST",
    "path": "/hook/ch_9x4kf2m",
    "requestHeaders": "{\\"content-type\\":\\"application/json\\"}",
    "requestBody": "{\\"type\\":\\"checkout.session.completed\\"}",
    "responseStatus": 200,
    "responseBody": "{\\"received\\":true}",
    "latencyMs": 12,
    "receivedAt": "2026-04-09T22:31:00Z"
  }
]`}</code>
			</pre>

			<h2>Webhooks</h2>

			<h3>Receive Webhook (external senders hit this)</h3>
			<pre>
				<code>{`POST /hook/:channelId
Content-Type: application/json

{ "type": "checkout.session.completed", ... }

→ 202 Accepted
{ "received": true, "eventId": "evt_abc123", "channelId": "ch_9x4kf2m" }`}</code>
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
