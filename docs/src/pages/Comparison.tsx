import { Callout } from "../components/Illustrations";

/*
 * Facts about other products were read from their own pricing pages and docs
 * on 2026-10-08 (ngrok.com/pricing, developers.cloudflare.com Quick Tunnels,
 * github.com/localtunnel/localtunnel). Re-check before changing a row.
 */

function Measured() {
	return (
		<p style={{ fontSize: 12, opacity: 0.6 }}>
			Other products&apos; details were read from their pricing pages and docs on 8 October 2026.
		</p>
	);
}

const BH = {
	install: "Chrome extension, or nothing (dashboard tab)",
	account: "Required (free plan)",
	url: "Permanent per port: https://<id>.bridgehook.dev",
	offline: "Queued and delivered in order when you are back",
	inspect: "Built in: request, your reply, latency, replay",
	agents: "Remote MCP server: agents send signed test events and read your handler's reply",
};

export function VsNgrok() {
	return (
		<>
			<h1>BridgeHook vs ngrok</h1>
			<p>
				ngrok is a general-purpose tunnel: it exposes a local port to the internet through an agent
				you run. BridgeHook is narrower: webhooks only, delivered through your browser, kept while
				you are offline.
			</p>
			<Measured />
			<table>
				<thead>
					<tr>
						<th />
						<th>ngrok (free plan)</th>
						<th>BridgeHook</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Install</td>
						<td>The ngrok agent (a binary)</td>
						<td>{BH.install}</td>
					</tr>
					<tr>
						<td>Account</td>
						<td>Required</td>
						<td>{BH.account}</td>
					</tr>
					<tr>
						<td>Stable URL</td>
						<td>One development domain per account</td>
						<td>{BH.url}</td>
					</tr>
					<tr>
						<td>Webhooks while your machine is off</td>
						<td>Fail at the provider (the tunnel is down)</td>
						<td>{BH.offline}</td>
					</tr>
					<tr>
						<td>Inspection</td>
						<td>Traffic Inspector, 24-hour retention</td>
						<td>{BH.inspect}</td>
					</tr>
					<tr>
						<td>Protocols</td>
						<td>HTTP/S; TCP after card verification; TLS on paid plans</td>
						<td>HTTP webhooks only</td>
					</tr>
					<tr>
						<td>Free allowance</td>
						<td>20k HTTP/S requests and 1 GB a month</td>
						<td>
							10 webhooks a day (<a href="#/billing">Billing</a>)
						</td>
					</tr>
					<tr>
						<td>Coding agents</td>
						<td>Not a focus</td>
						<td>{BH.agents}</td>
					</tr>
				</tbody>
			</table>
			<Callout icon="✅" title="Choose BridgeHook when" color="#28c840">
				You are building webhook handlers, especially with a coding agent, cannot or would rather
				not install a tunnel binary, or need webhooks sent while your laptop was shut to arrive
				afterwards.
			</Callout>
			<Callout icon="🔀" title="Choose ngrok when" color="#9093ff">
				You need to expose a whole app or API (browsers, mobile clients, TCP), want higher free
				volume, or need a tunnel that runs without a browser.
			</Callout>
		</>
	);
}

export function VsCloudflareTunnel() {
	return (
		<>
			<h1>BridgeHook vs Cloudflare Tunnel</h1>
			<p>
				Cloudflare Tunnel connects a service to Cloudflare through the <code>cloudflared</code>{" "}
				daemon. Named tunnels on your own domain are built for production; Quick Tunnels
				(trycloudflare) give a throwaway URL with no account.
			</p>
			<Measured />
			<table>
				<thead>
					<tr>
						<th />
						<th>Quick Tunnel</th>
						<th>Named tunnel</th>
						<th>BridgeHook</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Install</td>
						<td>
							<code>cloudflared</code>
						</td>
						<td>
							<code>cloudflared</code>
						</td>
						<td>{BH.install}</td>
					</tr>
					<tr>
						<td>Account</td>
						<td>None</td>
						<td>Cloudflare account and a domain on Cloudflare</td>
						<td>{BH.account}</td>
					</tr>
					<tr>
						<td>URL</td>
						<td>Random, new every run</td>
						<td>Your hostname, stable</td>
						<td>{BH.url}</td>
					</tr>
					<tr>
						<td>While your machine is off</td>
						<td>Fails</td>
						<td>Fails</td>
						<td>{BH.offline}</td>
					</tr>
					<tr>
						<td>Limits</td>
						<td>200 in-flight requests, no SSE, no uptime guarantee</td>
						<td>Production grade</td>
						<td>
							See <a href="#/billing">Billing</a>
						</td>
					</tr>
					<tr>
						<td>Webhook inspection and replay</td>
						<td>No</td>
						<td>No</td>
						<td>{BH.inspect}</td>
					</tr>
				</tbody>
			</table>
			<Callout icon="✅" title="Choose BridgeHook when" color="#28c840">
				You want one URL to register with a provider and keep, with history, replay and agent
				tooling, and without installing a daemon.
			</Callout>
			<Callout icon="🔀" title="Choose Cloudflare Tunnel when" color="#9093ff">
				You are exposing a real service in production, or need a stable hostname on your own domain
				for everything, not just webhooks. (BridgeHook itself runs on Cloudflare Workers.)
			</Callout>
		</>
	);
}

export function VsLocaltunnel() {
	return (
		<>
			<h1>BridgeHook vs localtunnel</h1>
			<p>
				localtunnel is an open-source tunnel started with <code>npx localtunnel --port 3000</code>,
				served from <code>loca.lt</code> or your own server.
			</p>
			<Measured />
			<table>
				<thead>
					<tr>
						<th />
						<th>localtunnel</th>
						<th>BridgeHook</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Install</td>
						<td>Node.js and the npm package (or Homebrew)</td>
						<td>{BH.install}</td>
					</tr>
					<tr>
						<td>Account</td>
						<td>None</td>
						<td>{BH.account}</td>
					</tr>
					<tr>
						<td>URL</td>
						<td>Random subdomain; a requested name is not guaranteed</td>
						<td>{BH.url}</td>
					</tr>
					<tr>
						<td>While your machine is off</td>
						<td>Fails</td>
						<td>{BH.offline}</td>
					</tr>
					<tr>
						<td>Inspection and replay</td>
						<td>No</td>
						<td>{BH.inspect}</td>
					</tr>
				</tbody>
			</table>
			<Callout icon="✅" title="Choose BridgeHook when" color="#28c840">
				The URL has to survive restarts, you want to see what your handler answered, or Node is not
				available.
			</Callout>
		</>
	);
}

export function Tradeoffs() {
	return (
		<>
			<h1>Tradeoffs</h1>
			<p>What BridgeHook is good at, and where something else is the better tool.</p>

			<h2>Good at</h2>
			<ul>
				<li>
					<strong>A URL you register once.</strong> Permanent per port, at its own host.
				</li>
				<li>
					<strong>Nothing lost while you are away.</strong> Webhooks queue and arrive in order.
				</li>
				<li>
					<strong>Seeing your handler&apos;s side.</strong> Status, body, latency and errors per
					webhook, with replay.
				</li>
				<li>
					<strong>Coding agents.</strong> An MCP server that sends signed provider events and
					reports what your code did.
				</li>
				<li>
					<strong>Locked-down machines.</strong> The dashboard tab needs no install at all.
				</li>
				<li>
					<strong>Open source.</strong> MIT, self-hostable on Cloudflare.
				</li>
			</ul>

			<h2>Limits</h2>
			<ul>
				<li>
					<strong>A forwarder must be running</strong> for webhooks to reach localhost: Chrome with
					the extension, or a dashboard tab. Until then they wait in the queue.
				</li>
				<li>
					<strong>Webhooks, not general traffic.</strong> HTTP requests up to 1 MB of body and 32 KB
					of headers. No TCP, WebSocket passthrough, gRPC or serving a website.
				</li>
				<li>
					<strong>Extra hops.</strong> Each webhook goes through Cloudflare and your browser before
					your server. Fine for webhooks and tool calls; keep tight deadlines such as Vapi&apos;s
					7.5 seconds in mind.
				</li>
				<li>
					<strong>Handler time.</strong> The extension waits up to 25 seconds for your server (a
					Chrome limit on extension background work); a dashboard tab waits up to 5 minutes.
				</li>
				<li>
					<strong>CORS in no-install mode.</strong> A dashboard tab needs one CORS rule on your
					server; the extension does not.
				</li>
				<li>
					<strong>Development only.</strong> Do not point production providers at a development URL.
				</li>
				<li>
					<strong>Free plan volume.</strong> 10 webhooks a day today (
					<a href="#/billing">Billing</a>).
				</li>
			</ul>

			<h2>When to use something else</h2>
			<table>
				<thead>
					<tr>
						<th>Need</th>
						<th>Use</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Expose a whole app, TCP or gRPC</td>
						<td>ngrok, or SSH tunneling</td>
					</tr>
					<tr>
						<td>A production ingress on your domain</td>
						<td>Cloudflare Tunnel</td>
					</tr>
					<tr>
						<td>Forwarding without any browser running</td>
						<td>
							A tunnel daemon, or the Stripe CLI&apos;s <code>stripe listen</code> for Stripe
						</td>
					</tr>
				</tbody>
			</table>
		</>
	);
}
