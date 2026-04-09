import { Callout, ProtocolCompare } from "../components/Illustrations";

export function SSETechnology() {
	return (
		<>
			<h1>SSE Technology</h1>
			<p>
				Server-Sent Events (SSE) is the core transport technology that makes BridgeHook work.
				Understanding SSE helps you understand why BridgeHook is so simple and reliable.
			</p>

			<h2>What Is SSE?</h2>
			<p>
				SSE is a standard web API for receiving a stream of events from a server over a single HTTP
				connection. It's the same technology that powers ChatGPT's streaming responses, live sports
				tickers, and real-time dashboards.
			</p>

			<Callout icon="📡" title="Same Tech, Different Purpose" color="#ddb7ff">
				In LLM streaming, SSE sends text tokens for the UI to render. In BridgeHook, SSE sends
				webhook payloads for the browser to forward to localhost. Same pipe, different cargo.
			</Callout>

			<h2>How SSE Differs From Regular HTTP</h2>
			<p>A normal HTTP request completes immediately:</p>
			<pre>
				<code>{`Browser: GET /api/data
Server:  200 OK { data: "here" }
→ Connection closes`}</code>
			</pre>

			<p>An SSE connection stays open — the server sends data whenever it wants:</p>
			<pre>
				<code>{`Browser: GET /hook/ch_9x4kf2m/events
Server:  200 OK (Content-Type: text/event-stream)

         data: {"type":"connected"}

         ...minutes pass, connection stays open...

         data: {"type":"webhook","method":"POST","path":"/webhook/stripe"}

         ...more minutes...

         data: {"type":"webhook","method":"POST","path":"/webhook/github"}

→ Connection stays open until the browser closes it`}</code>
			</pre>

			<h2>Why SSE and Not WebSocket?</h2>
			<ProtocolCompare />
			<p>
				BridgeHook only needs server-to-client pushing (the relay pushes webhook events to the
				browser). The browser sends responses back via regular <code>POST</code> requests — no
				bidirectional channel needed. SSE is simpler, more reliable, and works through every proxy
				and CDN.
			</p>

			<h2>The Browser API</h2>
			<p>SSE in the browser is a single line of code:</p>
			<pre>
				<code>{`const source = new EventSource('/hook/ch_9x4kf2m/events');

source.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // data.type === "webhook"
  // data.method, data.headers, data.body — everything needed
};

// The browser automatically reconnects if the connection drops.
// No manual reconnection logic needed.`}</code>
			</pre>

			<h2>How the Relay Implements SSE</h2>
			<p>
				On Cloudflare Workers, SSE is implemented using a <code>TransformStream</code> — a pipe with
				two ends:
			</p>
			<pre>
				<code>{`// When your browser connects:
const { readable, writable } = new TransformStream();
const writer = writable.getWriter();

// Store the writer — this is the "connection" to YOUR browser.
// It's a JavaScript object in the Worker's memory.
sseConnections.set(channelId, writer);

// Return the readable end — this HTTP response never closes:
return new Response(readable, {
  headers: { "Content-Type": "text/event-stream" }
});

// Later, when a webhook arrives:
const writer = sseConnections.get(channelId);
writer.write(encoder.encode('data: {"type":"webhook",...}\\n\\n'));
// → This instantly appears in your browser's EventSource`}</code>
			</pre>

			<Callout icon="🔌" title="The Connection Is Just RAM" color="#ffb0cd">
				The <code>WritableStreamDefaultWriter</code> stored in the Map is the relay's handle to your
				browser. It lives in the Worker's memory — not in a database, not on disk. Cloudflare's
				infrastructure handles the actual TCP/TLS delivery. The Worker just writes bytes into a
				pipe.
			</Callout>

			<h2>What Happens When the Connection Drops</h2>
			<ul>
				<li>
					<strong>Browser closes tab</strong> → SSE connection closes → Writer removed from Map →
					Events buffer in Neon DB
				</li>
				<li>
					<strong>Network blip</strong> → Browser's <code>EventSource</code> auto-reconnects →
					Writer re-added to Map
				</li>
				<li>
					<strong>Worker restarts</strong> → All SSE connections lost → Browsers auto-reconnect →
					Channels still exist in Neon
				</li>
			</ul>
		</>
	);
}
