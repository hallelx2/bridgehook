import { Callout } from "../components/Illustrations";

export function SelfHosting() {
	return (
		<>
			<h1>Self-Hosting</h1>
			<p>BridgeHook is fully open source. You can run the entire stack yourself.</p>

			<Callout icon="🔓" title="Self-host = no quotas, no paywalls" color="#28c840">
				When you run the relay without a <code>BETTER_AUTH_SECRET</code>, every channel attaches to
				a single implicit user with the <code>selfhost</code> tier — unlimited channels, unlimited
				devices, no event retention sweep, no Billing page. The hosted codebase and self-host
				codebase are the same binary; the difference is which env vars you set.
			</Callout>

			<h2>What You Need</h2>
			<table>
				<thead>
					<tr>
						<th>Component</th>
						<th>Options</th>
						<th>Free Tier</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Relay server</td>
						<td>Cloudflare Worker</td>
						<td>100K req/day</td>
					</tr>
					<tr>
						<td>Database</td>
						<td>Neon PostgreSQL</td>
						<td>0.5GB storage</td>
					</tr>
					<tr>
						<td>Web app</td>
						<td>Cloudflare Pages</td>
						<td>Unlimited bandwidth</td>
					</tr>
					<tr>
						<td>Domain</td>
						<td>Any registrar</td>
						<td>~$12/year</td>
					</tr>
				</tbody>
			</table>

			<h2>Setup</h2>

			<h3>1. Clone the repo</h3>
			<pre>
				<code>{`git clone https://github.com/hallelx2/bridgehook
cd bridgehook
pnpm install`}</code>
			</pre>

			<h3>2. Create a Neon database</h3>
			<pre>
				<code>{"neon projects create --name bridgehook --region-id aws-us-east-1"}</code>
			</pre>
			<p>Copy the connection URI from the output.</p>

			<h3>3. Push the schema</h3>
			<pre>
				<code>{`cd relay
DATABASE_URL="your-neon-connection-string" npx drizzle-kit push`}</code>
			</pre>
			<p>
				This applies every migration in <code>relay/drizzle/*.sql</code>. Re-run it after pulling
				new commits — the migrations are idempotent.
			</p>

			<h3>4. Configure the relay</h3>
			<p>
				Create <code>relay/.dev.vars</code>:
			</p>
			<pre>
				<code>{`# Required
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# Optional — leave unset for self-host mode (single implicit user)
# BETTER_AUTH_SECRET=...
# BETTER_AUTH_URL=...
# WEB_URL=http://localhost:5173
# RESEND_API_KEY=...
# MAIL_FROM=BridgeHook <noreply@yourdomain.com>

# Optional — leave unset to disable the Billing page entirely
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
wrangler secret put DATABASE_URL  # paste your Neon URL
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
							Single implicit user, no auth UI, no quotas, no Billing page, <code>/auth/**</code>{" "}
							returns 404, <code>/api/me/**</code> returns 404
						</td>
					</tr>
					<tr>
						<td>Hosted, free</td>
						<td>
							<code>BETTER_AUTH_SECRET</code> set, <code>POLAR_ACCESS_TOKEN</code> unset
						</td>
						<td>
							Magic-link login, device pairing, dashboard, but Billing page shows "billing not
							configured" and <code>/api/me/billing/**</code> returns 503
						</td>
					</tr>
					<tr>
						<td>Hosted, paid</td>
						<td>Both auth and Polar env vars set</td>
						<td>
							Full SaaS shape — trials, paywall, retention sweep, claim arbitration, UserDO push
						</td>
					</tr>
				</tbody>
			</table>

			<h2>Custom Domain</h2>
			<p>Add these DNS records in Cloudflare:</p>
			<pre>
				<code>{`yourdomain.com        → Cloudflare Pages (docs)
app.yourdomain.com    → Cloudflare Pages (web app)
relay.yourdomain.com  → Cloudflare Worker (relay)`}</code>
			</pre>
			<p>
				Update <code>VITE_RELAY_URL</code> in the web app to point to your relay domain. When auth
				is enabled across subdomains, also set <code>AUTH_COOKIE_DOMAIN=".yourdomain.com"</code> on
				the relay so the session cookie flows from <code>app.</code> to <code>relay.</code>.
			</p>

			<Callout icon="🔁" title="Updating an instance" color="#9093ff">
				After pulling new commits, re-run <code>npx drizzle-kit push</code> to apply any new
				migrations, then redeploy. Migrations are designed to be safe to re-run; they fail loudly if
				the DB has incompatible state (e.g. legacy bearer channels still present).
			</Callout>
		</>
	);
}
