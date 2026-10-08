import { Callout } from "../components/Illustrations";

export function SelfHosting() {
	return (
		<>
			<h1>Self-Hosting</h1>
			<p>BridgeHook is fully open source. You can run the entire stack yourself.</p>

			<Callout icon="🔓" title="Self-host = no quotas, no paywalls" color="#28c840">
				When you run the relay without a <code>BETTER_AUTH_SECRET</code>, every channel attaches to
				a single implicit user on the <code>selfhost</code> tier: unlimited channels and devices, no
				retention sweep, no Billing page. Hosted and self-hosted run the same code; which variables
				you set decides the mode.
			</Callout>

			<h2>What You Need</h2>
			<ul>
				<li>
					A Cloudflare account: the relay is a Worker with D1 and Durable Objects, and the web app
					and docs deploy to Pages. Small instances fit the free tiers.
				</li>
				<li>Node.js and pnpm.</li>
				<li>
					Optionally a domain on Cloudflare, for <code>&lt;id&gt;.yourdomain.com</code> webhook
					URLs.
				</li>
			</ul>

			<h2>Setup</h2>

			<h3>1. Clone the repo</h3>
			<pre>
				<code>{`git clone https://github.com/hallelx2/bridgehook
cd bridgehook
pnpm install`}</code>
			</pre>

			<h3>2. Create a D1 database</h3>
			<pre>
				<code>{`cd relay
npx wrangler d1 create bridgehook`}</code>
			</pre>
			<p>
				Put the printed <code>database_id</code> into the <code>[[d1_databases]]</code> block of{" "}
				<code>relay/wrangler.toml</code>.
			</p>

			<h3>3. Apply the schema</h3>
			<pre>
				<code>{`pnpm db:migrate:local    # local D1 used by wrangler dev
pnpm db:migrate:remote   # your Cloudflare D1, before deploying`}</code>
			</pre>
			<p>
				This applies every migration in <code>relay/migrations/</code>. Re-run it after pulling new
				commits; already-applied migrations are skipped.
			</p>

			<p>
				<strong>Upgrading a relay that ran on Neon/Postgres?</strong> Export your data with{" "}
				<code>DATABASE_URL=… python3 relay/scripts/neon-to-d1.py out.sql</code>, apply the schema
				with <code>pnpm db:migrate:remote</code>, then load it with{" "}
				<code>npx wrangler d1 execute bridgehook --remote --file out.sql</code> before deploying.
			</p>

			<h3>4. Configure the relay</h3>
			<p>
				Create <code>relay/.dev.vars</code>:
			</p>
			<pre>
				<code>{`# No database URL: the relay uses the D1 binding from wrangler.toml.

# Optional: leave unset for self-host mode (single implicit user)
# BETTER_AUTH_SECRET=...
# BETTER_AUTH_URL=...
# WEB_URL=http://localhost:5173
# AUTH_TRUSTED_ORIGINS=http://localhost:5173
# RESEND_API_KEY=...                (verification, password reset, magic links)
# MAIL_FROM=BridgeHook <noreply@yourdomain.com>
# GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=...
# GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...

# Optional: leave unset to disable the Billing page entirely
# POLAR_ACCESS_TOKEN=...
# POLAR_WEBHOOK_SECRET=whsec_...
# POLAR_PRODUCT_ID_HOBBY=prod_...
# POLAR_PRODUCT_ID_PRO=prod_...
# POLAR_PRODUCT_ID_TEAM=prod_...`}</code>
			</pre>

			<h3>5. Configure the web app</h3>
			<p>
				Create <code>apps/web/.env</code>:
			</p>
			<pre>
				<code>{"VITE_RELAY_URL=http://localhost:8787"}</code>
			</pre>

			<h3>6. Run locally</h3>
			<pre>
				<code>{`# Terminal 1: relay server (port 8787)
pnpm dev:relay

# Terminal 2: web app (port 5173)
pnpm dev:web`}</code>
			</pre>

			<h3>7. Deploy</h3>
			<pre>
				<code>{`# Relay → Cloudflare Workers
cd relay
pnpm db:migrate:remote
wrangler deploy

# Web app → Cloudflare Pages
# Connect your GitHub repo in the Cloudflare dashboard
# Build command: pnpm --filter @bridgehook/web build
# Output directory: apps/web/dist`}</code>
			</pre>

			<h2>Mode Reference</h2>
			<p>
				The relay runs in one of three shapes determined by which env vars are set. There's no flag
				to flip; the presence of secrets gates each subsystem.
			</p>
			<table>
				<thead>
					<tr>
						<th>Mode</th>
						<th>Triggered by</th>
						<th>What you get</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Self-host</td>
						<td>
							No <code>BETTER_AUTH_SECRET</code>
						</td>
						<td>
							One implicit user, no sign-in, no quotas, no Billing page; <code>/auth/**</code> and{" "}
							<code>/api/me/**</code> return 404
						</td>
					</tr>
					<tr>
						<td>Hosted, free</td>
						<td>
							<code>BETTER_AUTH_SECRET</code> set, <code>POLAR_ACCESS_TOKEN</code> unset
						</td>
						<td>
							Accounts (email and password; magic link and OAuth when configured), device pairing,
							agent tokens and MCP, per-plan quotas and retention. Billing reports &quot;not
							configured&quot;.
						</td>
					</tr>
					<tr>
						<td>Hosted, paid</td>
						<td>Auth and the Polar variables set</td>
						<td>Everything above plus checkout and paid tiers</td>
					</tr>
				</tbody>
			</table>

			<h2>Custom Domain</h2>
			<p>With a domain on Cloudflare:</p>
			<pre>
				<code>{`docs.yourdomain.com    → Pages (docs)
app.yourdomain.com     → Pages (web app)
relay.yourdomain.com   → Worker custom domain (API)
*.yourdomain.com       → proxied wildcard record + Worker route "*.yourdomain.com/*"`}</code>
			</pre>
			<p>
				Set <code>TUNNEL_DOMAIN = "yourdomain.com"</code> in the relay&apos;s <code>[vars]</code>{" "}
				and webhook URLs become <code>https://&lt;id&gt;.yourdomain.com</code>. Give the app and
				docs hosts routes without a script so the wildcard route does not capture them. Without{" "}
				<code>TUNNEL_DOMAIN</code>, URLs use the path form{" "}
				<code>https://relay.yourdomain.com/&lt;id&gt;</code>.
			</p>
			<p>
				Point <code>VITE_RELAY_URL</code> at the relay, set <code>WEB_URL</code>,{" "}
				<code>BETTER_AUTH_URL</code> and <code>AUTH_TRUSTED_ORIGINS</code>, and leave{" "}
				<code>AUTH_COOKIE_DOMAIN</code> unset when channel hosts share the domain (see{" "}
				<a href="#/auth">Authentication</a>).
			</p>

			<Callout icon="🔁" title="Updating an instance" color="#9093ff">
				After pulling new commits run <code>pnpm db:migrate:remote</code> in <code>relay/</code>,
				then redeploy the Worker. Apply migrations before deploying code that needs them; already
				applied migrations are skipped.
			</Callout>
		</>
	);
}
