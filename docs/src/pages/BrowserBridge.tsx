import { Callout } from "../components/Illustrations";

export function BrowserBridge() {
	return (
		<>
			<h1>No-install mode</h1>
			<p>
				A dashboard tab can do the extension&apos;s job. Open{" "}
				<a href="https://app.bridgehook.dev/dashboard/bridge" target="_blank" rel="noreferrer">
					Dashboard → Browser bridge
				</a>
				, enter your port, and that tab forwards your webhooks to localhost. Nothing to install,
				which suits locked-down laptops, a quick demo, or a machine you do not own.
			</p>

			<h2>Why a browser can do this</h2>
			<p>
				JavaScript in a page can call both the relay and your own machine. Browsers treat{" "}
				<code>http://localhost</code> as a secure origin, so an HTTPS page may fetch it:
			</p>
			<pre>
				<code>{`fetch("https://relay.bridgehook.dev/…")   // the internet
fetch("http://localhost:3000/…")           // your machine`}</code>
			</pre>

			<h2>The CORS rule</h2>
			<p>
				A page may <em>send</em> to localhost, but it can only <em>read</em> the answer if your
				server allows the page&apos;s origin. Without the answer there is nothing to report, so
				no-install mode needs one rule on your dev server:
			</p>
			<pre>
				<code>{`Access-Control-Allow-Origin: https://app.bridgehook.dev
Access-Control-Allow-Methods: *
Access-Control-Allow-Headers: *`}</code>
			</pre>
			<p>
				Webhooks carry custom headers such as <code>Stripe-Signature</code>, so the browser sends a
				preflight <code>OPTIONS</code> request first. Your server has to answer it, which is why
				allowing headers matters. When the dashboard sees the block it shows the line for your
				framework:
			</p>
			<pre>
				<code>{`// Express
app.use(cors({ origin: "https://app.bridgehook.dev" }));

// Hono
app.use("*", cors({ origin: "https://app.bridgehook.dev" }));

# FastAPI
app.add_middleware(CORSMiddleware, allow_origins=["https://app.bridgehook.dev"],
                   allow_methods=["*"], allow_headers=["*"])`}</code>
			</pre>
			<Callout icon="🧩" title="Rather not touch CORS?" color="#FF8A5C">
				The{" "}
				<a
					href="https://chromewebstore.google.com/detail/gfblggfnemgdflgpkoieddinpoodmppg"
					target="_blank"
					rel="noreferrer"
				>
					Chrome extension
				</a>{" "}
				forwards from its background worker, which browsers do not hold to CORS. Same URL, same
				queue, no server change.
			</Callout>

			<h2>The delivery loop</h2>
			<p>
				The tab drains the channel&apos;s queue the same way the extension does, so you can switch
				between them freely:
			</p>
			<ol>
				<li>
					Read the queue oldest first (<code>GET /api/channels/:id/events?pending=1</code>), page by
					page.
				</li>
				<li>
					<strong>Claim</strong> the event, so only one forwarder handles it, and keep refreshing
					the claim while your handler runs. If another forwarder already holds it, stop there
					rather than let newer webhooks overtake it.
				</li>
				<li>Forward it to localhost and report your server&apos;s status, headers and body.</li>
			</ol>
			<table>
				<thead>
					<tr>
						<th>What happened</th>
						<th>What the tab does</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Your server is down</td>
						<td>
							Stops at that event, shows how many are queued, retries every few seconds. Outages
							never count against an event.
						</td>
					</tr>
					<tr>
						<td>Your server blocks CORS</td>
						<td>Same, and shows the CORS line for your framework.</td>
					</tr>
					<tr>
						<td>The request itself keeps failing while the server is up</td>
						<td>
							After 3 attempts, records status 0 with the error and moves on, so one bad payload
							cannot block the rest.
						</td>
					</tr>
					<tr>
						<td>Your handler takes more than 5 minutes</td>
						<td>
							Records a timeout once. It does not resend, because the handler may still be running
							on a breakpoint.
						</td>
					</tr>
				</tbody>
			</table>
			<p>
				The extension applies the same rules with one difference: it waits 25 seconds, not 5
				minutes, because Chrome stops an extension&apos;s background worker when a request takes
				longer than 30 seconds. To step through a handler on a breakpoint, forward from a dashboard
				tab.
			</p>
			<p>
				While the tab cannot deliver, it checks your server <em>before</em> claiming, so it never
				holds an event the extension could deliver. A tab that leaves the page mid-request still
				reports the answer it got, so nothing runs twice.
			</p>

			<h2>When the tab is closed</h2>
			<p>
				Webhooks keep arriving at the relay and wait in the queue. Open the tab again, or start the
				extension, and they are delivered in the order they arrived.
			</p>

			<h2>Sync mode from a tab</h2>
			<p>
				<a href="#/sync-responses">Sync channels</a> work too: the sender is held until the tab
				reports your server&apos;s answer, then gets that answer. Your server must allow CORS, since
				the tab has to read the reply to pass it on.
			</p>
		</>
	);
}
