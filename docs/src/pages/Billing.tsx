import { Callout } from "../components/Illustrations";

export function Billing() {
	return (
		<>
			<h1>Billing</h1>
			<p>
				Hosted BridgeHook is on the <strong>Free plan</strong> for everyone today. Paid plans are
				not on sale yet.
			</p>

			<h2>Free plan limits</h2>
			<table>
				<thead>
					<tr>
						<th>Limit</th>
						<th>Free</th>
						<th>Self-hosted</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Channels (ports with a URL)</td>
						<td>1</td>
						<td>Unlimited</td>
					</tr>
					<tr>
						<td>Paired devices</td>
						<td>1 (agent tokens do not count; up to 10)</td>
						<td>Unlimited</td>
					</tr>
					<tr>
						<td>Webhooks accepted per day (UTC)</td>
						<td>10</td>
						<td>Unlimited</td>
					</tr>
					<tr>
						<td>Event history</td>
						<td>3 days (not yet enforced: older events are currently kept)</td>
						<td>Kept until you delete it</td>
					</tr>
				</tbody>
			</table>
			<p>
				Requests rejected by the path allowlist do not count toward the daily cap. When the cap is
				reached, the URL answers <code>402</code> with <code>{'{"code":"quota"}'}</code> until
				midnight UTC. Your usage for the day is on the dashboard&apos;s Overview and in the
				extension popup.
			</p>
			<p>
				Limits live in <code>packages/shared/src/pricing.ts</code>, which both the relay&apos;s
				enforcement and the Billing page read, so they cannot disagree.
			</p>

			<h2>For operators: enabling paid plans</h2>
			<p>
				The relay integrates with{" "}
				<a href="https://polar.sh" target="_blank" rel="noreferrer">
					Polar
				</a>{" "}
				as merchant of record: Polar runs checkout, tax, invoices and the customer portal; the relay
				maps subscriptions to plans and enforces limits. Paid tiers stay hidden until the{" "}
				<code>POLAR_*</code> variables below are set and the tiers are added to{" "}
				<code>PUBLIC_PLAN_ORDER</code>.
			</p>

			<h3>Polar setup</h3>
			<ol>
				<li>
					Create a Polar account at{" "}
					<a href="https://polar.sh" target="_blank" rel="noreferrer">
						polar.sh
					</a>
					.
				</li>
				<li>
					Create three products: <strong>Hobby</strong>, <strong>Pro</strong>, <strong>Team</strong>{" "}
					at the prices you choose. Polar charges what its product says; the relay maps the product
					id to a plan and reads limits from <code>PLANS</code>.
				</li>
				<li>
					Generate a server access token from <em>Settings → Developer</em> →{" "}
					<em>Create access token</em>. Scope it to <code>checkouts:write</code>,{" "}
					<code>customer_sessions:write</code>, <code>subscriptions:read</code>.
				</li>
				<li>
					Configure a webhook endpoint at <code>https://relay.example.com/api/billing/webhook</code>
					, subscribe to <code>subscription.created</code>, <code>subscription.updated</code>,{" "}
					<code>subscription.canceled</code>, <code>subscription.revoked</code>. Copy the webhook
					secret (<code>whsec_…</code>).
				</li>
			</ol>

			<h3>Relay env vars</h3>
			<pre>
				<code>{`wrangler secret put POLAR_ACCESS_TOKEN
wrangler secret put POLAR_WEBHOOK_SECRET
wrangler secret put POLAR_PRODUCT_ID_HOBBY
wrangler secret put POLAR_PRODUCT_ID_PRO
wrangler secret put POLAR_PRODUCT_ID_TEAM`}</code>
			</pre>
			<p>
				With all five set, <code>/api/config</code> reports <code>billingEnabled: true</code> and
				the Billing page shows real checkout buttons. Leave any of them unset to drop into the
				"billing not configured" UI, <code>/api/me/billing/**</code> returns 503.
			</p>

			<h3>Webhook signatures</h3>
			<p>
				Polar uses the{" "}
				<a href="https://www.standardwebhooks.com/" target="_blank" rel="noreferrer">
					standardwebhooks.com
				</a>{" "}
				format. The relay verifies three headers on every webhook:
			</p>
			<table>
				<thead>
					<tr>
						<th>Header</th>
						<th>Purpose</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>webhook-id</code>
						</td>
						<td>Unique event id: used in the signed value.</td>
					</tr>
					<tr>
						<td>
							<code>webhook-timestamp</code>
						</td>
						<td>Unix seconds. Rejected if more than 5 minutes off "now" (replay protection).</td>
					</tr>
					<tr>
						<td>
							<code>webhook-signature</code>
						</td>
						<td>
							Space-separated <code>v1,&lt;base64&gt;</code> entries (multiple support key
							rotation).
						</td>
					</tr>
				</tbody>
			</table>
			<p>
				The signed value is <code>{"`${id}.${timestamp}.${rawBody}`"}</code>, HMAC-SHA256 with the
				webhook secret. Verification is constant-time. See{" "}
				<code>relay/src/billing.ts → verifyPolarWebhook()</code>.
			</p>

			<h3>Plan lifecycle</h3>
			<table>
				<thead>
					<tr>
						<th>Polar status</th>
						<th>
							<code>users.plan</code> result
						</th>
						<th>
							<code>readOnly</code>?
						</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>active</code> / <code>trialing</code>
						</td>
						<td>
							Mapped from <code>product_id</code> → <code>hobby</code>/<code>pro</code>/
							<code>team</code>
						</td>
						<td>No</td>
					</tr>
					<tr>
						<td>
							<code>past_due</code>
						</td>
						<td>Unchanged</td>
						<td>
							No (graceful, Polar dunning runs; transitions to canceled when payment gives up)
						</td>
					</tr>
					<tr>
						<td>
							<code>canceled</code> / <code>revoked</code>
						</td>
						<td>
							<code>trialing</code>
						</td>
						<td>
							Yes (with <code>reason: "subscription-canceled"</code>)
						</td>
					</tr>
				</tbody>
			</table>

			<Callout icon="🔁" title="Idempotent webhook handler" color="#28c840">
				The relay upserts the <code>subscriptions</code> row on the user_id primary key and computes{" "}
				<code>users.plan</code> deterministically from the product id, so redelivery is safe. Polar
				retries are not a problem.
			</Callout>

			<h2>Quota enforcement</h2>
			<p>
				Channel and device quotas are checked on every create against{" "}
				<code>PLANS[plan].limits.maxChannels</code> / <code>maxDevices</code> and answer{" "}
				<code>402</code> with <code>{'{"code":"quota"}'}</code> when reached. The daily event cap is
				counted in KV per UTC day. Accounts on a canceled subscription, or from the retired 7-day
				trial after it ended, are read-only: they can view history but not create channels, pair
				devices or replay.
			</p>
			<p>
				The hourly cron in <code>relay/src/index.ts → scheduled()</code> sweeps events past their
				plan's <code>retentionDays</code>. The selfhost tier has{" "}
				<code>retentionDays = Infinity</code> and is excluded; self-host instances skip the sweep
				entirely (no <code>BETTER_AUTH_SECRET</code> = no sweep loop).
			</p>
		</>
	);
}
