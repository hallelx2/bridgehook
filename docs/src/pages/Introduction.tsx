import { Callout, StepTimeline } from "../components/Illustrations";

export function Introduction() {
	return (
		<>
			<h1>Introduction</h1>
			<p>
				<strong>BridgeHook</strong> is a zero-install webhook testing tool that uses your browser as
				a local proxy. No tunnels, no CLI tools, no binaries — open a URL, enter your port, and
				start receiving webhooks on localhost.
			</p>

			<Callout icon="💡" title="Core Insight" color="#9093ff">
				Your browser is already running on your machine. It can{" "}
				<code>fetch('http://localhost:3000')</code> freely. A remote website's JavaScript executes{" "}
				<strong>inside your browser</strong>, so it has the same localhost access. No tunnel needed
				— the browser IS the bridge.
			</Callout>

			<h2>The Problem</h2>
			<p>
				When developing with webhooks (Stripe, GitHub, Twilio, etc.), the remote service needs to
				reach your <code>localhost</code>. Today's solutions all require installing something:
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
						<td>Pinggy</td>
						<td>SSH client</td>
					</tr>
				</tbody>
			</table>
			<p>
				<strong>BridgeHook requires nothing.</strong> If your machine has a browser, you can test
				webhooks.
			</p>

			<h2>How It Works in 30 Seconds</h2>
			<StepTimeline
				steps={[
					{
						title: "Open BridgeHook",
						desc: "Visit the web app. No account, no download.",
						code: "bridgehook-web.pages.dev",
						color: "#9093ff",
					},
					{
						title: "Enter your port",
						desc: "Type the port your local server runs on and which paths to allow.",
						code: "localhost:3000",
						color: "#ddb7ff",
					},
					{
						title: "Copy your webhook URL",
						desc: "Get a unique URL. Paste it into Stripe, GitHub, or any webhook provider.",
						code: "bridgehook-relay.halleluyaholudele.workers.dev/hook/ch_9x4kf2m",
						color: "#ffb0cd",
					},
					{
						title: "Webhooks flow to localhost",
						desc: "Events arrive in real-time. Your browser forwards them to your local server and sends responses back.",
						code: "→ 200 OK (12ms)",
						color: "#28c840",
					},
				]}
			/>

			<h2>Who Is This For?</h2>
			<ul>
				<li>
					<strong>Individual developers</strong> — zero setup, zero cost, works immediately
				</li>
				<li>
					<strong>Developers on locked-down machines</strong> — corporate laptops that block
					installing software, university computers, shared workstations
				</li>
				<li>
					<strong>Teams</strong> — shareable channels for collaborative debugging, no license
					management
				</li>
				<li>
					<strong>Quick demos</strong> — show a colleague how your webhook handler works in 10
					seconds
				</li>
			</ul>

			<h2>What You Get</h2>
			<ul>
				<li>A unique webhook URL per session</li>
				<li>Real-time event feed with request/response inspection</li>
				<li>Automatic forwarding to your localhost server</li>
				<li>Response relay back to the webhook sender</li>
				<li>24-hour auto-expiry channels, no cleanup needed</li>
				<li>Path allowlist for security — only approved endpoints get forwarded</li>
				<li>Full request/response history stored in the cloud</li>
			</ul>

			<Callout icon="🆓" title="Free & Open Source" color="#28c840">
				BridgeHook runs entirely on free-tier infrastructure: Cloudflare Workers (100K req/day),
				Neon PostgreSQL (0.5GB), and Cloudflare Pages (unlimited bandwidth). The only cost is a
				domain (~$12/year). Self-hosting is fully supported.
			</Callout>
		</>
	);
}
