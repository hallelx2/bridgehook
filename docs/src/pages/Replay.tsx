import { Callout } from "../components/Illustrations";

export function Replay() {
	return (
		<>
			<h1>Replay</h1>
			<p>
				Every webhook is persisted with its full request body, headers, response, and timing. From
				the dashboard you can replay any historical event back through your localhost — with
				optional edits to the body or headers — and BridgeHook records the new attempt as a child of
				the original.
			</p>

			<Callout icon="🔁" title="Why replay matters" color="#9093ff">
				Webhook providers don't send test events on demand. Without replay you have to either
				trigger the real action (cancel a subscription, refund a customer) or wait for one to happen
				organically. Replay lets you iterate on the handler with the exact production payload — same
				headers, same signature checks, everything.
			</Callout>

			<h2>Replay chain semantics</h2>
			<p>Each event row carries two columns that form the chain:</p>
			<ul>
				<li>
					<code>kind</code> — <code>"live"</code> or <code>"replay"</code>. Indexed; live events are
					immutable except for response data.
				</li>
				<li>
					<code>replay_of</code> — self-FK pointing at the source event. <code>null</code> on live
					events. A CHECK constraint enforces{" "}
					<code>(kind = 'replay') = (replay_of IS NOT NULL)</code> so you can't accidentally orphan
					one or fake the other.
				</li>
			</ul>
			<p>
				The chain is a tree (one source can have many replays; a replay can itself be replayed). The
				Event Detail page (<code>/dashboard/events/:id</code>) renders one level — the children of
				the current event plus the original it points at — and you drill into deeper history by
				following any child's link.
			</p>

			<h2>Triggering a replay</h2>
			<p>
				Click <strong>Replay</strong> on any event detail page. Optionally edit the body or headers
				in the modal that opens. The web client calls:
			</p>
			<pre>
				<code>{`POST /api/me/events/:id/replay
{
  "body": "...optional override...",
  "headers": { "x-foo": "bar" }
}`}</code>
			</pre>
			<p>The relay:</p>
			<ol>
				<li>
					Verifies session ownership (the channel must belong to the caller) and that the account
					isn't read-only.
				</li>
				<li>
					Inserts a new event row with <code>kind = "replay"</code>,{" "}
					<code>replay_of = source.id</code>, <code>replayed_by_user_id = caller.id</code>.
				</li>
				<li>
					Notifies both the channel DO and the user-DO so any connected SSE listener (the executor
					and the dashboard) wakes up immediately.
				</li>
			</ol>
			<p>
				The executor — your dashboard tab, paired extension, or desktop — picks up the new event on
				the next poll/SSE frame, races the claim, and forwards it to localhost exactly like a fresh
				webhook.
			</p>

			<h2>Cancelling a queued replay</h2>
			<p>
				Replays that haven't been answered yet (<code>response_status IS NULL</code>) can be
				cancelled with <code>DELETE /api/me/events/:id</code>. The endpoint refuses live events
				(they're immutable history) and refuses replays that already completed (409 Conflict).
			</p>

			<h2>Claim arbitration</h2>
			<p>
				When multiple executors are connected — the dashboard tab AND a paired extension, say — they
				race to forward each event. To prevent duplicate work, every executor calls{" "}
				<code>POST /hook/:channelId/claim</code> with its <code>clientId</code> before forwarding:
			</p>
			<pre>
				<code>{`POST /hook/ch_abc/claim
X-BH-Timestamp: 1700000000000
X-BH-Signature: <hex>
{ "eventId": "evt_xyz", "clientId": "web_<uuid>" }`}</code>
			</pre>
			<p>
				The endpoint runs an atomic{" "}
				<code>
					UPDATE events SET claimed_by_device_id = $1 WHERE id = $2 AND claimed_by_device_id IS NULL
				</code>{" "}
				— at most one client wins. The winner forwards; the loser sees <code>409</code> with the
				actual winner's <code>clientId</code> and drops the work. The DO fans out a{" "}
				<code>{'{ type: "claimed" }'}</code> SSE frame so other listeners can update the UI without
				waiting for the response round-trip.
			</p>

			<table>
				<thead>
					<tr>
						<th>Executor type</th>
						<th>
							<code>clientId</code> shape
						</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Dashboard tab</td>
						<td>
							<code>web_&lt;uuid&gt;</code>, sessionStorage-backed (survives refresh, new tab → new
							id)
						</td>
					</tr>
					<tr>
						<td>Extension / desktop / CLI</td>
						<td>
							<code>dev_&lt;20 alphanum&gt;</code> — the paired device's id from{" "}
							<code>devices.id</code>
						</td>
					</tr>
				</tbody>
			</table>

			<Callout icon="🧬" title="Replay attribution" color="#ddb7ff">
				When you replay an event the dashboard records you as the trigger (
				<code>replayed_by_user_id</code>) and the executor that forwarded the replay as the actor (
				<code>device_id</code> via the claim flow). The Team-tier audit log surfaces "who replayed
				what, when" by reading those columns directly.
			</Callout>
		</>
	);
}
