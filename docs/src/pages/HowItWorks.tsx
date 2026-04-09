import { ArchitectureDiagram, DataFlowDiagram } from "../components/FlowDiagram";

export function HowItWorks() {
	return (
		<>
			<h1>How It Works</h1>
			<p>
				BridgeHook uses a simple three-component architecture: a cloud relay, your browser, and your
				local dev server.
			</p>

			<h2>Architecture Overview</h2>
			<p>
				The relay sits in the cloud. Your browser connects to it. When a webhook arrives, the relay
				pushes it to your browser, which forwards it to localhost.
			</p>

			<ArchitectureDiagram />

			<h2>Step-by-Step Flow</h2>
			<p>Here's exactly what happens when a webhook fires:</p>

			<DataFlowDiagram />

			<h3>1. Channel Creation</h3>
			<p>
				When you click "Start Bridge", your browser sends a request to the relay server to create a
				new channel. The relay generates a unique channel ID, stores it in the database, and returns
				a webhook URL.
			</p>

			<h3>2. SSE Connection</h3>
			<p>
				Your browser opens a Server-Sent Events (SSE) connection to the relay. This is a long-lived
				HTTP connection that stays open — the relay can push data to your browser at any time
				through it.
			</p>

			<h3>3. Webhook Arrives</h3>
			<p>When Stripe (or any provider) POSTs to your webhook URL, the relay:</p>
			<ul>
				<li>Stores the event in the database</li>
				<li>Pushes the event through the SSE connection to your browser</li>
			</ul>

			<h3>4. Browser Forwards to Localhost</h3>
			<p>
				Your browser's JavaScript receives the SSE event and calls{" "}
				<code>fetch('http://localhost:3000/webhook/stripe')</code> with the exact same method,
				headers, and body. This works because the JS is running on your machine — it has direct
				access to localhost.
			</p>

			<h3>5. Response Returns</h3>
			<p>
				Your local server responds (e.g. <code>200 OK</code>). The browser captures this response
				and POSTs it back to the relay. The relay stores it and, if the original sender is still
				waiting, returns it as the HTTP response.
			</p>

			<h2>Why This Works</h2>
			<p>
				The key insight:{" "}
				<strong>
					your browser sits at the intersection of the internet and your local network
				</strong>
				. It can receive data from a remote server (SSE) and make requests to localhost (fetch). No
				other tool needed — the browser IS the bridge.
			</p>
		</>
	);
}
