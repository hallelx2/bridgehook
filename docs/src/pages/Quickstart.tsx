import { Callout, StepTimeline } from "../components/Illustrations";

export function Quickstart() {
	return (
		<>
			<h1>Quickstart</h1>
			<p>Get webhooks forwarding to your localhost in under 30 seconds.</p>

			<StepTimeline
				steps={[
					{
						title: "Open BridgeHook",
						desc: "Visit the web app. No account, no download, no install needed.",
						code: "bridgehook-web.pages.dev",
						color: "#9093ff",
					},
					{
						title: "Enter Your Port",
						desc: "Type the port your local dev server is running on. Optionally specify which paths to allow.",
						code: "Port: 3000  Paths: /webhook/stripe",
						color: "#ddb7ff",
					},
					{
						title: "Click Start Bridge",
						desc: "A channel is created. Your browser connects to the relay via SSE. You get a unique webhook URL.",
						color: "#ffb0cd",
					},
					{
						title: "Copy Your Webhook URL",
						desc: "Paste this URL into your webhook provider's dashboard (Stripe, GitHub, Twilio, etc.).",
						code: "bridgehook-relay.halleluyaholudele.workers.dev/hook/ch_9x4kf2m",
						color: "#fcd34d",
					},
					{
						title: "Watch Events Flow",
						desc: "Webhooks appear in real-time. Each one is forwarded to your localhost and the response is sent back to the provider.",
						code: "POST /webhook/stripe → 200 OK (12ms)",
						color: "#28c840",
					},
				]}
			/>

			<Callout icon="⚠️" title="Keep the Tab Open" color="#fcd34d">
				Your browser tab must stay open. The browser IS the bridge — closing the tab disconnects the
				relay and stops forwarding. For persistent background operation, use the desktop app (system
				tray).
			</Callout>

			<h2>Testing Manually</h2>
			<p>You can test your setup without a webhook provider using cURL:</p>
			<pre>
				<code>{`curl -X POST https://bridgehook-relay.halleluyaholudele.workers.dev/hook/ch_9x4kf2m \\
  -H "Content-Type: application/json" \\
  -d '{"test": true, "event": "checkout.session.completed"}'`}</code>
			</pre>
			<p>
				You should see the event appear in the dashboard and get forwarded to your local server. The
				response from your server will display alongside the request.
			</p>

			<h2>CORS Requirement</h2>
			<p>
				Your local dev server needs to accept cross-origin requests from the BridgeHook origin. Most
				frameworks support this in dev mode. If not, add this header:
			</p>
			<pre>
				<code>Access-Control-Allow-Origin: *</code>
			</pre>

			<h3>Framework Examples</h3>
			<pre>
				<code>{`// Express
app.use(cors());

// Next.js (API route)
// Headers are handled automatically in dev mode

// FastAPI
app.add_middleware(CORSMiddleware, allow_origins=["*"])

// Go (net/http)
w.Header().Set("Access-Control-Allow-Origin", "*")`}</code>
			</pre>

			<Callout icon="🔁" title="Replay Events" color="#9093ff">
				All events are stored in the database for 24 hours. You can view historical events when you
				reconnect, and replay any event to your local server with one click.
			</Callout>
		</>
	);
}
