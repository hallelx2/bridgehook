import { Callout, CompareCard } from "../components/Illustrations";

export function VsNgrok() {
	return (
		<>
			<h1>BridgeHook vs ngrok</h1>
			<p>ngrok is the most popular webhook testing tool. Here's how BridgeHook compares.</p>

			<div className="not-prose space-y-3 my-6">
				<CompareCard
					title="Setup"
					other="Download CLI binary, add to PATH"
					otherName="ngrok"
					bridgehook="Open a URL in your browser"
				/>
				<CompareCard
					title="Account"
					other="Required (free tier limited)"
					otherName="ngrok"
					bridgehook="None needed — anonymous channels"
				/>
				<CompareCard
					title="Stable URL"
					other="Rotates on every restart (free tier)"
					otherName="ngrok"
					bridgehook="Same URL until channel expires"
				/>
				<CompareCard
					title="Request Inspector"
					other="Paid add-on"
					otherName="ngrok"
					bridgehook="Built-in, free, real-time"
				/>
				<CompareCard
					title="Locked-Down Machines"
					other="Blocked — can't install binaries"
					otherName="ngrok"
					bridgehook="Works — only needs a browser"
				/>
				<CompareCard
					title="Protocol Support"
					other="HTTP, TCP, TLS, gRPC"
					otherName="ngrok"
					bridgehook="HTTP only"
				/>
				<CompareCard title="Latency" other="~50ms" otherName="ngrok" bridgehook="~100-200ms" />
				<CompareCard
					title="Background Operation"
					other="Background process"
					otherName="ngrok"
					bridgehook="Browser tab (desktop app for background)"
				/>
			</div>

			<Callout icon="✅" title="Choose BridgeHook when" color="#28c840">
				You want zero setup, can't install software, or need a quick webhook test without creating
				an account.
			</Callout>
			<Callout icon="➡️" title="Choose ngrok when" color="#9093ff">
				You need TCP/gRPC tunnels, lowest possible latency, or persistent background operation
				without a browser.
			</Callout>
		</>
	);
}

export function VsCloudflareTunnel() {
	return (
		<>
			<h1>BridgeHook vs Cloudflare Tunnel</h1>
			<p>
				Cloudflare Tunnel (<code>cloudflared</code>) is Cloudflare's official tunneling solution.
			</p>

			<div className="not-prose space-y-3 my-6">
				<CompareCard
					title="Setup"
					other="Download cloudflared binary"
					otherName="CF Tunnel"
					bridgehook="Open a URL"
				/>
				<CompareCard
					title="Account"
					other="Cloudflare account required"
					otherName="CF Tunnel"
					bridgehook="None needed"
				/>
				<CompareCard
					title="Request Inspector"
					other="No built-in inspector"
					otherName="CF Tunnel"
					bridgehook="Built-in, real-time"
				/>
				<CompareCard
					title="DNS Integration"
					other="Full Cloudflare DNS + SSL"
					otherName="CF Tunnel"
					bridgehook="Not needed — uses relay URL"
				/>
				<CompareCard
					title="Protocol"
					other="HTTP, TCP, SSH, RDP"
					otherName="CF Tunnel"
					bridgehook="HTTP only"
				/>
				<CompareCard
					title="Latency"
					other="~30ms (edge network)"
					otherName="CF Tunnel"
					bridgehook="~100-200ms"
				/>
			</div>

			<Callout icon="✅" title="Choose BridgeHook when" color="#28c840">
				You just need webhook testing and don't want to deal with DNS configuration or binary
				installs.
			</Callout>
			<Callout icon="➡️" title="Choose Cloudflare Tunnel when" color="#9093ff">
				You need a full production tunnel with TCP support integrated into Cloudflare's network.
			</Callout>
		</>
	);
}

export function VsLocaltunnel() {
	return (
		<>
			<h1>BridgeHook vs localtunnel</h1>
			<p>localtunnel is a simple npm-based tunneling tool.</p>

			<div className="not-prose space-y-3 my-6">
				<CompareCard
					title="Setup"
					other="npm install -g localtunnel"
					otherName="localtunnel"
					bridgehook="Open a URL"
				/>
				<CompareCard
					title="Stable URL"
					other="Random, changes each time"
					otherName="localtunnel"
					bridgehook="Stable per channel"
				/>
				<CompareCard
					title="Inspector"
					other="None"
					otherName="localtunnel"
					bridgehook="Built-in, real-time"
				/>
				<CompareCard
					title="Reliability"
					other="Single server, frequent downtime"
					otherName="localtunnel"
					bridgehook="Cloudflare edge (99.9%)"
				/>
				<CompareCard
					title="Event History"
					other="None — fire and forget"
					otherName="localtunnel"
					bridgehook="24h persistent history in Neon"
				/>
			</div>

			<Callout icon="✅" title="Choose BridgeHook when" color="#28c840">
				You want the same simplicity as localtunnel but without npm, with stable URLs, and with a
				reliable infrastructure.
			</Callout>
		</>
	);
}

export function Tradeoffs() {
	return (
		<>
			<h1>Tradeoffs</h1>
			<p>BridgeHook makes specific tradeoffs. Here's the honest picture.</p>

			<h2>What BridgeHook Does Best</h2>
			<ul>
				<li>
					<strong>Zero installation</strong> — nothing to download, install, or configure
				</li>
				<li>
					<strong>No account</strong> — anonymous, auto-expiring channels
				</li>
				<li>
					<strong>Works anywhere</strong> — locked-down machines, corporate laptops, Chromebooks
				</li>
				<li>
					<strong>Built-in inspection</strong> — see every request and response in the UI
				</li>
				<li>
					<strong>Stable URLs</strong> — don't change on restart
				</li>
				<li>
					<strong>Easy to understand</strong> — no magic, you can see exactly what happens at every
					step
				</li>
				<li>
					<strong>Free and open source</strong> — self-host or use the hosted version
				</li>
			</ul>

			<h2>What BridgeHook Cannot Do</h2>

			<Callout icon="🖥️" title="Browser tab must stay open" color="#fcd34d">
				Close the tab and the bridge dies. The desktop app (Phase 2) solves this with a background
				Rust process in the system tray.
			</Callout>

			<ul>
				<li>
					<strong>HTTP only</strong> — no TCP tunnels, WebSocket passthrough, or gRPC
				</li>
				<li>
					<strong>~100-200ms latency</strong> — the SSE → fetch → response round-trip adds overhead
				</li>
				<li>
					<strong>CORS required</strong> — your local server needs CORS headers for the browser to
					forward requests
				</li>
				<li>
					<strong>Not for production</strong> — designed for development and testing only
				</li>
				<li>
					<strong>No subdomain routing</strong> — channels use path-based routing, not custom
					subdomains
				</li>
			</ul>

			<h2>When to Use Something Else</h2>
			<table>
				<thead>
					<tr>
						<th>Need</th>
						<th>Use</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>TCP/gRPC tunnels</td>
						<td>ngrok</td>
					</tr>
					<tr>
						<td>Production-grade tunnel</td>
						<td>Cloudflare Tunnel</td>
					</tr>
					<tr>
						<td>Sub-10ms latency</td>
						<td>Any local tunnel binary</td>
					</tr>
					<tr>
						<td>Non-HTTP services</td>
						<td>ngrok or SSH tunneling</td>
					</tr>
					<tr>
						<td>Always-on without browser</td>
						<td>BridgeHook Desktop (coming soon)</td>
					</tr>
				</tbody>
			</table>
		</>
	);
}
