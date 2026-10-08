export function RelayAPI() {
	return (
		<>
			<h1>Relay API Reference</h1>
			<p>
				The hosted relay is <code>https://relay.bridgehook.dev</code>; webhook intake is on each
				channel&apos;s own host. All API responses are JSON.
			</p>

			<h2>Authentication</h2>
			<table>
				<thead>
					<tr>
						<th>Credential</th>
						<th>Sent as</th>
						<th>Used for</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Session</td>
						<td>
							Cookie from <code>/auth/*</code>
						</td>
						<td>
							The dashboard: <code>/api/me/*</code>, creating channels
						</td>
					</tr>
					<tr>
						<td>Device token</td>
						<td>
							<code>Authorization: Bearer dvc_…</code>
						</td>
						<td>
							The extension: creating channels, reading <code>/api/me</code>
						</td>
					</tr>
					<tr>
						<td>Agent token</td>
						<td>
							<code>Authorization: Bearer dvc_…</code> (kind <code>agent</code>)
						</td>
						<td>
							<code>/mcp</code> only
						</td>
					</tr>
					<tr>
						<td>Channel signature</td>
						<td>
							<code>X-BH-Timestamp</code> and <code>X-BH-Signature</code> (
							<a href="#/channel-secrets">Channel Keys</a>)
						</td>
						<td>Reading a channel&apos;s events, claiming, reporting answers</td>
					</tr>
				</tbody>
			</table>

			<h2>Webhook intake</h2>
			<pre>
				<code>{`POST https://2324radf23r.bridgehook.dev/api/webhooks/stripe?x=1
Content-Type: application/json

{ "type": "checkout.session.completed", ... }

→ 202 Accepted
{ "received": true, "eventId": "…", "channelId": "2324radf23r" }

# forwarded to http://localhost:<port>/api/webhooks/stripe?x=1`}</code>
			</pre>
			<ul>
				<li>
					Methods: <code>POST</code>, <code>PUT</code>, <code>PATCH</code>, <code>DELETE</code>.
					Sync channels also forward <code>GET</code> and <code>HEAD</code>. A <code>GET</code> to
					an async channel answers with a short description of the URL.
				</li>
				<li>
					<code>403</code> path not allowed, <code>402</code> daily cap reached (
					<code>code: "quota"</code>), <code>413</code> body over 1 MB, <code>431</code> headers
					over 32 KB.
				</li>
				<li>
					Sync channels: the sender gets your server&apos;s reply, <code>504</code> on timeout or{" "}
					<code>502</code> if localhost is unreachable. See{" "}
					<a href="#/sync-responses">Sync responses</a>.
				</li>
				<li>
					The relay host also accepts <code>/&lt;channelId&gt;[/path]</code> and{" "}
					<code>/hook/&lt;channelId&gt;</code> for older URLs and self-hosted relays without
					wildcard DNS. When channel hosts are configured, a sync channel answers those forms with{" "}
					<code>421</code>.
				</li>
			</ul>

			<h2>Channels</h2>
			<h3>Create</h3>
			<pre>
				<code>{`POST /api/channels            (session or device token)
{
  "publicKey": "04…",            // 130-hex uncompressed ECDSA P-256 point
  "port": 3000,
  "allowedPaths": ["/api/webhooks"],   // optional, [] = every path
  "label": "stripe-dev",         // optional
  "responseMode": "async",       // optional: "async" | "sync"
  "syncTimeoutMs": 25000         // optional: clamped to 1000–100000
}

→ 201 Created
{
  "channelId": "2324radf23r",
  "port": 3000,
  "label": "stripe-dev",
  "expiresAt": null,
  "webhookUrl": "https://2324radf23r.bridgehook.dev",
  "responseMode": "async",
  "syncTimeoutMs": 25000,
  "authScheme": "ecdsa"
}`}</code>
			</pre>
			<p>
				<code>401</code> without a session or device token, <code>402</code> at the plan&apos;s
				channel limit, <code>429</code> after 10 creates a minute from one IP. Forwarders normally
				call <code>GET /api/me/channels</code> first and reuse the channel for the port.
			</p>

			<h3>Read and delete</h3>
			<pre>
				<code>{`GET /api/channels/:id           public: port, allowedPaths, responseMode, webhookUrl
DELETE /api/channels/:id        signed, or session of the owner`}</code>
			</pre>

			<h2>Events and the delivery queue</h2>
			<pre>
				<code>{`GET /api/channels/:id/events?limit=50           signed; newest first, max 100
→ [ { "id", "method", "path", "requestHeaders", "requestBody",
      "responseStatus", "responseBody", "latencyMs", "error", "receivedAt", ... } ]

GET /api/channels/:id/events?pending=1&limit=100&after=<cursor>   signed
→ { "events": [ …unanswered, oldest first… ], "nextCursor": "…" | null }`}</code>
			</pre>

			<h3>Claim</h3>
			<pre>
				<code>{`POST /hook/:id/claim             signed
{ "eventId": "…", "clientId": "web_…" }

→ 200 { "claimed": true, "claimerId": "web_…", "claimedAt": "…" }
→ 409 { "claimed": false, "claimerId": "dev_…", "claimedAt": "…" }`}</code>
			</pre>
			<p>
				A claim succeeds when nobody holds the event, when the caller already does (refreshing it),
				or when the holder&apos;s claim is more than 60 seconds old and unanswered.
			</p>

			<h3>Report the answer</h3>
			<pre>
				<code>{`POST /hook/:id/response          signed
{ "eventId": "…", "status": 200, "headers": { … }, "body": "…", "latencyMs": 12 }

→ 200 { "ok": true }`}</code>
			</pre>
			<p>
				Status <code>0</code> records a delivery that failed. Bodies over 1 MB get <code>413</code>,
				headers over 32 KB get <code>431</code>.
			</p>

			<h2>Account API (session; reads also accept a device token)</h2>
			<table>
				<tbody>
					<tr>
						<td>
							<code>GET /api/me</code>
						</td>
						<td>User, plan, usage today</td>
					</tr>
					<tr>
						<td>
							<code>GET /api/me/channels</code>
						</td>
						<td>Your channels with 24-hour stats</td>
					</tr>
					<tr>
						<td>
							<code>PATCH /api/me/channels/:id</code>
						</td>
						<td>
							<code>label</code>, <code>allowedPaths</code>, <code>responseMode</code>,{" "}
							<code>syncTimeoutMs</code>
						</td>
					</tr>
					<tr>
						<td>
							<code>POST /api/me/channels/:id/rotate-key</code>
						</td>
						<td>Adopt a channel with a new public key (session or device token)</td>
					</tr>
					<tr>
						<td>
							<code>DELETE /api/me/channels/:id</code>
						</td>
						<td>Delete a channel and its events</td>
					</tr>
					<tr>
						<td>
							<code>GET /api/me/events</code>, <code>GET /api/me/events/:id</code>
						</td>
						<td>Events across all channels, with filters and cursor paging</td>
					</tr>
					<tr>
						<td>
							<code>POST /api/me/events/:id/replay</code>
						</td>
						<td>
							Queue a replay, optionally with a new body or headers (<a href="#/replay">Replay</a>)
						</td>
					</tr>
					<tr>
						<td>
							<code>GET /api/me/devices</code>, <code>POST /api/me/devices/self-register</code>,{" "}
							<code>DELETE /api/me/devices/:id</code>
						</td>
						<td>
							Devices and agent tokens (<a href="#/device-pairing">Device Pairing</a>)
						</td>
					</tr>
					<tr>
						<td>
							<code>GET /api/me/stream</code>
						</td>
						<td>
							Live updates over SSE (<a href="#/sse-events">SSE Events</a>)
						</td>
					</tr>
				</tbody>
			</table>

			<h2>Other endpoints</h2>
			<table>
				<tbody>
					<tr>
						<td>
							<code>/mcp</code>
						</td>
						<td>
							MCP server, Streamable HTTP (<a href="#/ai-agents">AI agents</a>)
						</td>
					</tr>
					<tr>
						<td>
							<code>GET /api/config</code>
						</td>
						<td>Which sign-in methods and features this relay has enabled</td>
					</tr>
					<tr>
						<td>
							<code>GET /health</code>
						</td>
						<td>
							<code>{'{ "status": "ok" }'}</code>
						</td>
					</tr>
				</tbody>
			</table>

			<h2>Limits</h2>
			<table>
				<thead>
					<tr>
						<th>Limit</th>
						<th>Value</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Request or reply body</td>
						<td>1 MB</td>
					</tr>
					<tr>
						<td>Request or reply headers</td>
						<td>32 KB</td>
					</tr>
					<tr>
						<td>Webhooks per day</td>
						<td>
							Per plan (<a href="#/billing">Billing</a>)
						</td>
					</tr>
					<tr>
						<td>Channel creation</td>
						<td>10 per minute per IP</td>
					</tr>
					<tr>
						<td>Sync timeout</td>
						<td>1 to 100 seconds, default 25</td>
					</tr>
					<tr>
						<td>Event list page</td>
						<td>100</td>
					</tr>
				</tbody>
			</table>
		</>
	);
}
