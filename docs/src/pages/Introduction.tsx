import { Callout, StepTimeline } from "../components/Illustrations";

export function Introduction() {
	return (
		<>
			<h1>Introduction</h1>
			<p>
				<strong>BridgeHook</strong> is an open-source webhook tunnel <em>and</em> observability
				layer that runs entirely inside a browser tab. Open a URL, enter your localhost port, and
				start receiving webhooks — no CLI, no binary, no npm package, no account.
			</p>

			<Callout icon="🌉" title="The core idea" color="#FF5C26">
				Your browser is already running on your machine. Modern browsers allow HTTPS pages to{" "}
				<code>fetch("http://localhost:3000")</code> for exactly this kind of use case. A remote
				site's JavaScript executes <strong>inside your browser</strong>, so it has the same
				localhost access. No tunnel daemon needed —{" "}
				<strong>the browser tab IS the tunnel agent.</strong>
			</Callout>

			<h2>The problem</h2>
			<p>
				When developing with webhooks (Stripe, GitHub, Twilio, Shopify, Clerk), the remote service
				needs to reach your <code>localhost</code>. Today's solutions all require installing
				something:
			</p>
			<table>
				<thead>
					<tr>
						<th>Tool</th>
						<th>Requires</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>ngrok</td>
						<td>CLI binary + account</td>
					</tr>
					<tr>
						<td>Cloudflare Tunnel</td>
						<td>
							<code>cloudflared</code> binary
						</td>
					</tr>
					<tr>
						<td>localtunnel</td>
						<td>npm package</td>
					</tr>
					<tr>
						<td>smee.io (forwarder)</td>
						<td>
							<code>smee-client</code> npm package
						</td>
					</tr>
					<tr>
						<td>Pinggy</td>
						<td>SSH client</td>
					</tr>
				</tbody>
			</table>
			<p>
				<strong>BridgeHook requires nothing.</strong> If your machine has a browser, you can test
				webhooks. That's it.
			</p>

			<h2>How it works in 30 seconds</h2>
			<StepTimeline
				steps={[
					{
						title: "Open BridgeHook",
						desc: "Visit the web app. No account, no download.",
						code: "bridgehook.dev",
						color: "#FF5C26",
					},
					{
						title: "Enter your port",
						desc: "Type the port your local server runs on, plus the paths you want to allow.",
						code: "localhost:3000",
						color: "#FF8A5C",
					},
					{
						title: "Copy your webhook URL",
						desc: "Get a unique URL. Paste it into Stripe, GitHub, or any provider.",
						code: "relay.bridgehook.dev/hook/ch_9x4kf2m",
						color: "#FF5C26",
					},
					{
						title: "Webhooks flow to localhost",
						desc: "Events arrive in real time. Your browser forwards them to your local server and sends responses back.",
						code: "→ 200 OK (12ms)",
						color: "#28c840",
					},
				]}
			/>

			<h2>What's actually new</h2>
			<p>
				The pieces are not all new. SSE-based webhook relays go back to{" "}
				<a href="https://smee.io" target="_blank" rel="noreferrer">
					smee.io
				</a>{" "}
				in 2017. The novelty is the <strong>combination</strong> of three things that finally lined
				up:
			</p>
			<ol>
				<li>
					<strong>Browser as the localhost forwarder.</strong> The W3C secure-contexts spec (~2016)
					marked <code>localhost</code> as a "potentially trustworthy origin," so HTTPS pages can{" "}
					<code>fetch()</code> it without mixed-content blocking. Without this, the bridge cannot
					exist.
				</li>
				<li>
					<strong>Cloudflare Durable Objects holding the SSE.</strong> Workers max out at 30s of CPU
					per request — DOs hold the SSE indefinitely and hibernate when idle. This is what makes
					"open the bridge all day on the free tier" feasible.
				</li>
				<li>
					<strong>A polished observability UI on top.</strong> Filter, replay, edit-and-replay,
					signature verification, mock responses, throughput, p50/p95/p99 latency. All in the same
					browser tab, free, open source.
				</li>
			</ol>

			<Callout icon="📜" title="Prior art" color="#FF5C26">
				BridgeHook didn't invent SSE webhook relaying — <strong>smee.io</strong> by the Probot team
				has done it since 2017. We took the wire shape from them and added: the browser-as-forwarder
				trick, Cloudflare's free hibernating edge, and a full observability dashboard. If you want
				the smallest possible relay, smee.io is excellent. If you want the relay <em>and</em> a
				webhook inspector in one tab, that's BridgeHook.
			</Callout>

			<h2>Who is this for?</h2>
			<ul>
				<li>
					<strong>Individual developers</strong> — zero setup, zero cost, works immediately
				</li>
				<li>
					<strong>Developers on locked-down machines</strong> — corporate laptops, university
					computers, shared workstations. If it has a browser, it works.
				</li>
				<li>
					<strong>Teams</strong> — share a channel ID and the secret with a teammate to debug
					together
				</li>
				<li>
					<strong>Quick demos</strong> — show a colleague how your webhook handler works in 10
					seconds, no install on their end
				</li>
				<li>
					<strong>Self-hosters</strong> — clone the repo, point at your own Neon DB, deploy to your
					own Cloudflare account. Same code, same features, your data.
				</li>
			</ul>

			<h2>What you get</h2>
			<ul>
				<li>A unique webhook URL per session, anonymous, 24-hour TTL</li>
				<li>Real-time event feed with method, path, status, latency, and timing</li>
				<li>Per-event detail view: pretty-printed headers, JSON body tree, response body</li>
				<li>
					<strong>Stats panel</strong> — throughput sparkline, p50 / p95 / p99 latency, error rate,
					status distribution
				</li>
				<li>
					<strong>Filter bar</strong> — search by path/body, filter by status class (2xx/4xx/5xx),
					filter by method
				</li>
				<li>
					<strong>Replay</strong> any event, or <strong>edit & replay</strong> with modified
					headers/body/method
				</li>
				<li>
					<strong>Copy as cURL</strong> for any captured webhook — paste straight into your terminal
				</li>
				<li>
					<strong>Signature verification</strong> for Stripe, GitHub, Shopify, Clerk, Linear, Slack
				</li>
				<li>
					<strong>Mock-response mode</strong> — return canned responses without forwarding to
					localhost
				</li>
				<li>
					<strong>Command palette</strong> (⌘K) — replay last, copy URL, fire test request, manage
					secrets
				</li>
				<li>Path allowlist — only approved endpoints get forwarded to localhost</li>
			</ul>

			<Callout icon="🆓" title="Free & open source" color="#28c840">
				BridgeHook is MIT-licensed and runs entirely on free-tier infrastructure: Cloudflare Workers
				(100K req/day), Durable Objects, Neon PostgreSQL (0.5 GB), and Cloudflare Pages (unlimited
				bandwidth). The only cost is a domain (~$12/year). Self-hosting is fully supported and is{" "}
				<strong>the same code</strong> you see on bridgehook.dev — no enterprise tier, no paywalled
				features, no closed-source server.
			</Callout>
		</>
	);
}
