export function SelfHosting() {
	return (
		<>
			<h1>Self-Hosting</h1>
			<p>BridgeHook is fully open source. You can run the entire stack yourself.</p>

			<h2>What You Need</h2>
			<table>
				<thead>
					<tr><th>Component</th><th>Options</th><th>Free Tier</th></tr>
				</thead>
				<tbody>
					<tr><td>Relay server</td><td>Cloudflare Worker</td><td>100K req/day</td></tr>
					<tr><td>Database</td><td>Neon PostgreSQL</td><td>0.5GB storage</td></tr>
					<tr><td>Web app</td><td>Cloudflare Pages</td><td>Unlimited bandwidth</td></tr>
					<tr><td>Domain</td><td>Any registrar</td><td>~$12/year</td></tr>
				</tbody>
			</table>

			<h2>Setup</h2>

			<h3>1. Clone the repo</h3>
			<pre><code>{`git clone https://github.com/yourname/bridgehook
cd bridgehook
pnpm install`}</code></pre>

			<h3>2. Create a Neon database</h3>
			<pre><code>{`neon projects create --name bridgehook --region-id aws-us-east-1`}</code></pre>
			<p>Copy the connection URI from the output.</p>

			<h3>3. Push the schema</h3>
			<pre><code>{`cd relay
DATABASE_URL="your-neon-connection-string" npx drizzle-kit push`}</code></pre>

			<h3>4. Configure the relay</h3>
			<p>Create <code>relay/.dev.vars</code>:</p>
			<pre><code>{`DATABASE_URL=postgresql://user:pass@host/db?sslmode=require`}</code></pre>

			<h3>5. Configure the web app</h3>
			<p>Create <code>apps/web/.env</code>:</p>
			<pre><code>{`VITE_RELAY_URL=http://localhost:8787`}</code></pre>

			<h3>6. Run locally</h3>
			<pre><code>{`# Terminal 1: relay server
pnpm dev:relay

# Terminal 2: web app
pnpm dev:web`}</code></pre>

			<h3>7. Deploy</h3>
			<pre><code>{`# Deploy relay to Cloudflare Workers
cd relay
wrangler secret put DATABASE_URL  # paste your Neon URL
wrangler deploy

# Deploy web app to Cloudflare Pages
# Connect your GitHub repo in the Cloudflare dashboard
# Build command: pnpm --filter @bridgehook/web build
# Output directory: apps/web/dist`}</code></pre>

			<h2>Custom Domain</h2>
			<p>Add these DNS records in Cloudflare:</p>
			<pre><code>{`yourdomain.com        → Cloudflare Pages (docs)
app.yourdomain.com    → Cloudflare Pages (web app)
relay.yourdomain.com  → Cloudflare Worker (relay)`}</code></pre>
			<p>
				Update <code>VITE_RELAY_URL</code> in the web app to point to your relay domain.
			</p>
		</>
	);
}
