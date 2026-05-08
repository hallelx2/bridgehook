import { Callout } from "../components/Illustrations";

export function Auth() {
	return (
		<>
			<h1>Authentication</h1>
			<p>
				BridgeHook uses{" "}
				<a href="https://better-auth.com" target="_blank" rel="noreferrer">
					Better-Auth
				</a>{" "}
				with a magic-link-only flow. No passwords, no OAuth providers at launch — just an email and
				a click.
			</p>

			<Callout icon="🪄" title="Why magic links?" color="#9093ff">
				BridgeHook is a developer tool, not a social product. The threat model rules out password
				reuse risks, and OAuth would force every user to pick a provider they already trust the
				relay with. Magic links keep the cost-of-entry low and the attack surface small.
			</Callout>

			<h2>Sign-in flow</h2>
			<ol>
				<li>
					User enters their email at <code>/login</code>.
				</li>
				<li>
					The web client calls <code>POST /auth/sign-in/magic-link</code> on the relay.
				</li>
				<li>
					Better-Auth signs a token (15-minute TTL), persists a verification record, and hands the
					URL to <code>relay/src/email.ts</code> for delivery.
				</li>
				<li>
					Email arrives via Resend (when <code>RESEND_API_KEY</code> is set) or the console mailer
					(in dev).
				</li>
				<li>
					User clicks the link, which lands on <code>/auth/magic-link/verify</code>. The relay
					validates the token, creates a session row, and sets the session cookie.
				</li>
				<li>
					New users get a 7-day trial via the Better-Auth <code>databaseHooks</code>:{" "}
					<code>plan = "trialing"</code>, <code>trialEndsAt = now + 7d</code>.
				</li>
			</ol>

			<h2>Session cookie</h2>
			<p>
				Better-Auth issues an HTTP-only, Secure, SameSite=Lax cookie. Single-domain deploys work out
				of the box. For cross-subdomain setups (the typical hosted shape with{" "}
				<code>app.example.com</code> + <code>relay.example.com</code>), set:
			</p>
			<pre>
				<code>{`AUTH_COOKIE_DOMAIN=.example.com
AUTH_TRUSTED_ORIGINS=https://app.example.com,https://relay.example.com`}</code>
			</pre>
			<p>
				The trusted-origins list is consulted by Better-Auth for CSRF; the cookie domain makes the
				cookie readable by both subdomains so the dashboard at <code>app.</code> can hit the relay
				at <code>relay.</code> with credentials.
			</p>

			<h2>Required env vars (hosted mode)</h2>
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Purpose</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>BETTER_AUTH_SECRET</code>
						</td>
						<td>
							32+ byte random — cookie signing, CSRF token derivation. Generate with{" "}
							<code>openssl rand -hex 32</code>.
						</td>
					</tr>
					<tr>
						<td>
							<code>BETTER_AUTH_URL</code>
						</td>
						<td>
							Public URL of the relay (e.g. <code>https://relay.example.com</code>). Used to build
							absolute redirect URIs.
						</td>
					</tr>
					<tr>
						<td>
							<code>WEB_URL</code>
						</td>
						<td>
							Public URL of the dashboard (e.g. <code>https://app.example.com</code>). Used to build
							the magic-link callback and device-pairing redirect.
						</td>
					</tr>
				</tbody>
			</table>

			<h2>Optional env vars</h2>
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Purpose</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>RESEND_API_KEY</code>
						</td>
						<td>
							Production email delivery. When unset, magic links print to <code>console.log</code>{" "}
							for local dev.
						</td>
					</tr>
					<tr>
						<td>
							<code>MAIL_FROM</code>
						</td>
						<td>
							Sender address — e.g. <code>BridgeHook &lt;noreply@example.com&gt;</code>.
						</td>
					</tr>
					<tr>
						<td>
							<code>AUTH_COOKIE_DOMAIN</code>
						</td>
						<td>Cross-subdomain cookie scope.</td>
					</tr>
					<tr>
						<td>
							<code>AUTH_TRUSTED_ORIGINS</code>
						</td>
						<td>Comma-separated CSRF allowlist.</td>
					</tr>
					<tr>
						<td>
							<code>SELF_HOST_USER_ID</code>
						</td>
						<td>
							Pin the implicit self-host user to a specific id. Lets multiple relay instances share
							one Neon DB without conflicting on <code>self-host@local</code>.
						</td>
					</tr>
				</tbody>
			</table>

			<h2>Resolving the caller</h2>
			<p>
				Routes that need to know "who is calling" use <code>resolveCaller()</code> in{" "}
				<code>relay/src/identity.ts</code>. It tries two realms in order:
			</p>
			<ol>
				<li>
					<strong>Device-token bearer:</strong> <code>Authorization: Bearer dvc_…</code> —
					SHA-256-hashed and looked up against <code>devices.token_hash</code> (only non-revoked
					rows match). Used by the extension, desktop, and CLI.
				</li>
				<li>
					<strong>Better-Auth session cookie:</strong> the dashboard's path. Calls{" "}
					<code>auth.api.getSession()</code> which validates the cookie and returns the user.
				</li>
			</ol>
			<p>
				A <code>null</code> return means anonymous; channel-create rejects with 401 in hosted mode
				and short-circuits to the implicit self-host user otherwise.
			</p>

			<Callout icon="🛡️" title="Read-only fallback" color="#fcd34d">
				When a user's trial expires (or their subscription cancels), the access layer flips them to
				read-only. They can still sign in and view past events, but channel create, device pairing,
				and replay all 402 with <code>{'{"code":"quota"}'}</code>. The dashboard renders an amber
				banner pointing to /dashboard/billing.
			</Callout>
		</>
	);
}
