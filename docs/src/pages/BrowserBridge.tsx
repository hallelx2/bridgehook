export function BrowserBridge() {
	return (
		<>
			<h1>The Browser Bridge</h1>
			<p>
				The browser is the central piece of BridgeHook's architecture. It's the only component that
				can reach both the internet and your localhost simultaneously.
			</p>

			<h2>Why the Browser?</h2>
			<p>
				JavaScript running in your browser has a unique capability: it can make HTTP requests to{" "}
				<strong>both</strong> remote servers and <code>localhost</code>. No other approach gives you
				this without installing software:
			</p>
			<pre>
				<code>{`// Same browser tab, same JavaScript:
fetch("https://bridgehook-relay.halleluyaholudele.workers.dev/...")  // ✓ reaches the internet
fetch("http://localhost:3000/...")          // ✓ reaches your machine`}</code>
			</pre>

			<h2>The Bridge Loop</h2>
			<p>When a webhook arrives, the browser JavaScript executes this loop:</p>
			<pre>
				<code>{`// 1. Receive webhook event from relay via SSE
source.onmessage = async (event) => {
  const webhook = JSON.parse(event.data);

  // 2. Forward to your local server
  const start = performance.now();
  const response = await fetch(\`http://localhost:\${port}\${webhook.path}\`, {
    method: webhook.method,
    headers: webhook.headers,
    body: webhook.body,
  });

  // 3. Send response back to relay
  await fetch(\`\${relayUrl}/hook/\${channelId}/response\`, {
    method: 'POST',
    body: JSON.stringify({
      eventId: webhook.id,
      status: response.status,
      body: await response.text(),
      latencyMs: Math.round(performance.now() - start),
    }),
  });
};`}</code>
			</pre>

			<h2>What Happens When You Close the Tab?</h2>
			<p>
				The bridge dies immediately. The SSE connection closes, and the relay stops forwarding
				events to your browser. Webhooks that arrive while you're disconnected are stored in the
				database — but they won't be forwarded to localhost until you reconnect.
			</p>
			<blockquote>
				<p>
					For persistent background operation without a browser tab, BridgeHook offers a desktop app
					(system tray) that performs the same bridge function using a native Rust process.
				</p>
			</blockquote>

			<h2>Multiple Ports</h2>
			<p>
				The browser can forward to any port. You can even run multiple channels forwarding to
				different ports simultaneously — each channel is independent.
			</p>

			<h2>CORS Considerations</h2>
			<p>
				When your browser makes a <code>fetch()</code> call to <code>localhost</code> from the
				BridgeHook page, CORS rules apply. Your local dev server needs to accept requests from the
				BridgeHook origin:
			</p>
			<pre>
				<code>Access-Control-Allow-Origin: https://bridgehook-web.pages.dev</code>
			</pre>
			<p>
				Most frameworks (Express, Next.js, FastAPI, Rails) have CORS middleware that handles this
				with one line in development mode.
			</p>
		</>
	);
}
