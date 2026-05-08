import { Callout } from "../components/Illustrations";

export function Billing() {
	return (
		<>
			<h1>Billing</h1>
			<p>
				BridgeHook integrates with{" "}
				<a href="https://polar.sh" target="_blank" rel="noreferrer">
					Polar
				</a>{" "}
				as the merchant-of-record. Polar handles the checkout, tax, invoicing, and the customer
				portal; the relay handles the plan flip, quota gating, and webhook signature verification.
			</p>

			<Callout icon="💳" title="Why Polar (not Stripe direct)?" color="#9093ff">
				Polar is MoR — they collect the money, file the tax. For a single dev shipping a dev tool,
				that's the difference between "ships next week" and "ships once you set up VAT registration
				in 27 countries." Trade-off: ~5% above the bare Stripe rate. Acceptable.
			</Callout>

			<h2>Tier overview</h2>
			<p>
				Tiers are defined in <code>packages/shared/src/pricing.ts</code> — the single source of
				truth. Both the Billing UI and the relay's quota enforcement read from the same{" "}
				<code>PLANS</code> object, so a price change is one file diff.
			</p>
			<table>
				<thead>
					<tr>
						<th>Plan</th>
						<th>Monthly</th>
						<th>Channels</th>
						<th>Devices</th>
						<th>Retention</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>trialing</code>
						</td>
						<td>Free 7d</td>
						<td>5</td>
						<td>2</td>
						<td>7d</td>
					</tr>
					<tr>
						<td>
							<code>hobby</code>
						</td>
						<td>$2</td>
						<td>5</td>
						<td>2</td>
						<td>7d</td>
					</tr>
					<tr>
						<td>
							<code>pro</code>
						</td>
						<td>$9</td>
						<td>∞</td>
						<td>∞</td>
						<td>30d</td>
					</tr>
					<tr>
						<td>
							<code>team</code>
						</td>
						<td>$29</td>
						<td>∞</td>
						<td>∞</td>
						<td>90d</td>
					</tr>
				</tbody>
			</table>

			<h2>Polar setup</h2>
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
					— at the prices shown above (or whatever you decide; the relay reads pricing from{" "}
					<code>PLANS</code>, Polar just charges what its product says).
				</li>
				<li>
					Generate a server access token from <em>Settings → Developer</em> →{" "}
					<em>Create access token</em>. Scope it to <code>checkouts:write</code>,{" "}
					<code>customer_sessions:write</code>, <code>subscriptions:read</code>.
				</li>
				<li>
					Configure a webhook endpoint at <code>https://relay.example.com/api/billing/webhook</code>{" "}
					— subscribe to <code>subscription.created</code>, <code>subscription.updated</code>,{" "}
					<code>subscription.canceled</code>, <code>subscription.revoked</code>. Copy the webhook
					secret (<code>whsec_…</code>).
				</li>
			</ol>

			<h2>Relay env vars</h2>
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
				"billing not configured" UI — <code>/api/me/billing/**</code> returns 503.
			</p>

			<h2>Webhook signatures</h2>
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
						<td>Unique event id — used in the signed value.</td>
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

			<h2>Plan lifecycle</h2>
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
							No (graceful — Polar dunning runs; transitions to canceled when payment gives up)
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

			<h2>Trial and quota enforcement</h2>
			<p>
				Trial users (<code>plan = "trialing"</code>) have full Hobby-tier limits until{" "}
				<code>trialEndsAt</code>. After that the access layer flips them to read-only (
				<code>402 Payment Required</code> on writes). Channel and device quotas are checked on every
				create against <code>PLANS[plan].limits.maxChannels</code> / <code>maxDevices</code>; replay
				just checks the read-only flag.
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
