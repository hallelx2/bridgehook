import { Callout } from "../components/Illustrations";

export function Auth() {
	return (
		<>
			<h1>Authentication</h1>
			<p>
				BridgeHook uses{" "}
				<a href="https://better-auth.com" target="_blank" rel="noreferrer">
					Better-Auth
				</a>
				. Sign-in methods switch on as the relay is configured for them:
			</p>
			<table>
				<thead>
					<tr>
						<th>Method</th>
						<th>Available when</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Email and password</td>
						<td>Always (8 to 128 characters, PBKDF2-SHA256)</td>
					</tr>
					<tr>
						<td>Email verification, password reset, magic link (15 minutes)</td>
						<td>
							A mailer is configured (<code>RESEND_API_KEY</code>)
						</td>
					</tr>
					<tr>
						<td>GitHub, Google</td>
						<td>
							<code>GITHUB_CLIENT_ID</code>/<code>GITHUB_CLIENT_SECRET</code>,{" "}
							<code>GOOGLE_CLIENT_ID</code>/<code>GOOGLE_CLIENT_SECRET</code> are set
						</td>
					</tr>
				</tbody>
			</table>
			<p>
				The login page asks the relay which methods are on and shows only those. New accounts start
				on the Free plan (see <a href="#/billing">Billing</a>).
			</p>

			<h2>Sign-up and sign-in</h2>
			<ol>
				<li>
					<code>POST /auth/sign-up/email</code> creates the account and signs you in in the same
					request. Once a mailer is configured, new accounts must verify their email first.
				</li>
				<li>
					<code>POST /auth/sign-in/email</code> signs in an existing account;{" "}
					<code>POST /auth/sign-in/magic-link</code> sends a one-time link when magic links are on.
				</li>
				<li>The relay sets the session cookie, which the dashboard sends with every API call.</li>
			</ol>

			<h2>Session cookie</h2>
			<p>
				The session cookie is HTTP-only and Secure. Its <code>SameSite</code> mode depends on how
				the dashboard and relay are deployed:
			</p>
			<ul>
				<li>
					<strong>Separate sites</strong> (the hosted shape: <code>app.bridgehook.dev</code> calling{" "}
					<code>relay.bridgehook.dev</code>, no <code>AUTH_COOKIE_DOMAIN</code>):{" "}
					<code>SameSite=None</code>, scoped to the relay host. The origin policy only accepts
					credentialed requests from <code>AUTH_TRUSTED_ORIGINS</code>.
				</li>
				<li>
					<strong>Shared parent domain</strong> (<code>AUTH_COOKIE_DOMAIN</code> set):{" "}
					<code>SameSite=Lax</code>, readable by every subdomain of that domain.
				</li>
			</ul>
			<pre>
				<code>{`AUTH_TRUSTED_ORIGINS=https://app.example.com
# AUTH_COOKIE_DOMAIN=.example.com   only if no channel hosts live under example.com`}</code>
			</pre>
			<Callout icon="⚠️" title="Never share a cookie domain with channel hosts" color="#fcd34d">
				Webhook URLs are <code>&lt;id&gt;.&lt;TUNNEL_DOMAIN&gt;</code>. If{" "}
				<code>AUTH_COOKIE_DOMAIN</code> covered that apex, the browser would attach your session
				cookie to requests for channel hosts, whose replies come from users&apos; servers. Leave it
				unset, as hosted BridgeHook does, or use a different parent domain. (The relay also strips
				its own cookies from forwarded webhooks.)
			</Callout>

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
							32+ byte random: cookie signing, CSRF token derivation. Generate with{" "}
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
							Email delivery. Turns on verification, password reset and magic links. When unset,
							links print to <code>console.log</code> for local development.
						</td>
					</tr>
					<tr>
						<td>
							<code>GITHUB_CLIENT_ID</code>, <code>GITHUB_CLIENT_SECRET</code>
						</td>
						<td>Sign in with GitHub.</td>
					</tr>
					<tr>
						<td>
							<code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>
						</td>
						<td>Sign in with Google.</td>
					</tr>
					<tr>
						<td>
							<code>MAIL_FROM</code>
						</td>
						<td>
							Sender address: e.g. <code>BridgeHook &lt;noreply@example.com&gt;</code>.
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
							one D1 database without conflicting on <code>self-host@local</code>.
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
					<strong>Device-token bearer:</strong> <code>Authorization: Bearer dvc_…</code>:
					SHA-256-hashed and looked up against <code>devices.token_hash</code> (only non-revoked
					rows match). Used by the extension, and by agent tokens, which are accepted only on{" "}
					<code>/mcp</code>.
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
				When a paid subscription is canceled (or an account from the retired 7-day trial has run
				out), the access layer flips it to read-only. They can still sign in and view past events,
				but channel create, device pairing, and replay all 402 with{" "}
				<code>{'{"code":"quota"}'}</code>. The dashboard renders an amber banner pointing to
				/dashboard/billing.
			</Callout>
		</>
	);
}
