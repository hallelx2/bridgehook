import { Callout } from "../components/Illustrations";

/**
 * Provider guides. Signature schemes, header names, tolerances and response
 * contracts were checked against each provider's docs and SDK source on
 * 2026-10-08; re-check before changing a claim here.
 */

function Checked() {
	return (
		<p style={{ fontSize: 12, opacity: 0.6 }}>
			Checked against the provider&apos;s documentation and SDK source on 8 October 2026.
		</p>
	);
}

function AgentPrompt({ children }: { children: string }) {
	return (
		<>
			<h2>Have your agent test it</h2>
			<p>
				With the <a href="#/ai-agents">BridgeHook MCP server</a> connected, ask:
			</p>
			<pre>
				<code>{children}</code>
			</pre>
		</>
	);
}

export function OpenAIGuide() {
	return (
		<>
			<h1>OpenAI webhooks</h1>
			<p>
				OpenAI calls your endpoint when background work finishes: a background response, a batch, a
				fine-tuning job, an eval run. These can land minutes or hours after the request, which is
				where a permanent URL and a queue matter: a webhook that arrives while your laptop is shut
				is delivered when it opens.
			</p>
			<Checked />

			<h2>What OpenAI sends</h2>
			<table>
				<tbody>
					<tr>
						<td>Scheme</td>
						<td>
							<a href="https://www.standardwebhooks.com/" target="_blank" rel="noreferrer">
								Standard Webhooks
							</a>
							, HMAC-SHA256
						</td>
					</tr>
					<tr>
						<td>Headers</td>
						<td>
							<code>webhook-id</code>, <code>webhook-timestamp</code>,{" "}
							<code>webhook-signature</code> (<code>v1,&lt;base64&gt;</code>)
						</td>
					</tr>
					<tr>
						<td>Signed content</td>
						<td>
							<code>{"${webhook-id}.${webhook-timestamp}.${raw body}"}</code>, keyed with the base64
							part of your <code>whsec_</code> secret
						</td>
					</tr>
					<tr>
						<td>Tolerance</td>
						<td>5 minutes (SDK default)</td>
					</tr>
					<tr>
						<td>Expected answer</td>
						<td>
							Any <code>2xx</code>, quickly. Failures are retried with backoff for up to 72 hours;
							redirects count as failures. Use <code>webhook-id</code> to drop duplicates.
						</td>
					</tr>
				</tbody>
			</table>

			<h2>Set up</h2>
			<ol>
				<li>Add your port in BridgeHook and copy the URL, plus your route, for example:</li>
			</ol>
			<pre>
				<code>https://8f3a2c1d9e4b.bridgehook.dev/api/webhooks/openai</code>
			</pre>
			<ol start={2}>
				<li>
					In the OpenAI dashboard, create a webhook endpoint with that URL and choose the events.
					Copy the signing secret into <code>OPENAI_WEBHOOK_SECRET</code>.
				</li>
			</ol>

			<h2>Handler</h2>
			<pre>
				<code>{`import express from "express";
import OpenAI from "openai";

const openai = new OpenAI(); // reads OPENAI_WEBHOOK_SECRET
const app = express();

// The signature covers the raw body: parse it yourself, after verifying.
app.post("/api/webhooks/openai", express.text({ type: "*/*" }), async (req, res) => {
  try {
    const event = await openai.webhooks.unwrap(req.body, req.headers);
    if (event.type === "response.completed") {
      // fetch the response by event.data.id and store it
    }
    res.sendStatus(200);
  } catch {
    res.sendStatus(400); // bad signature or too old
  }
});`}</code>
			</pre>

			<AgentPrompt>{`Send a signed OpenAI response.completed webhook to port 3000 at /api/webhooks/openai
(secret: the OPENAI_WEBHOOK_SECRET in .env). Fix the handler until it returns 200.`}</AgentPrompt>
			<p>
				<code>send_test_event</code> signs with the Standard Webhooks scheme, so{" "}
				<code>unwrap()</code> verifies it for real. It expects a <code>whsec_</code> secret and says
				so if the value is not valid base64.
			</p>
		</>
	);
}

export function ElevenLabsGuide() {
	return (
		<>
			<h1>ElevenLabs agents</h1>
			<p>
				ElevenLabs Agents use webhooks in two directions. <strong>Server tools</strong> call your
				API in the middle of a conversation and pass your reply back to the model, so the answer has
				to come back to ElevenLabs: use a <a href="#/sync-responses">sync channel</a>.{" "}
				<strong>Post-call webhooks</strong> deliver the transcript, analysis or audio after the call
				and only need a <code>200</code>: the default async channel is right.
			</p>
			<Checked />

			<h2>Server tools (sync)</h2>
			<p>
				A server tool is an HTTP request the agent makes with the method, URL, path, query and body
				parameters you configure, filled in by the model from the conversation. Authentication is
				whatever you configure on the tool (a bearer token or custom header stored as a secret,
				Basic auth, or OAuth2).
			</p>
			<ol>
				<li>
					Switch the channel to sync: Dashboard → Channels → <b>Your server&apos;s reply</b>, or ask
					your agent to call <code>set_response_mode</code>.
				</li>
				<li>
					Set the tool URL to your channel URL plus route, for example{" "}
					<code>https://8f3a2c1d9e4b.bridgehook.dev/tools/lookup-order</code>.
				</li>
				<li>
					Your local handler&apos;s JSON reply is what the agent receives. If it does not answer
					within the channel&apos;s sync timeout, ElevenLabs gets <code>504</code>.
				</li>
			</ol>

			<h2>Post-call webhooks (async)</h2>
			<table>
				<tbody>
					<tr>
						<td>Header</td>
						<td>
							<code>ElevenLabs-Signature: t=&lt;unix seconds&gt;,v0=&lt;hex&gt;</code>
						</td>
					</tr>
					<tr>
						<td>Signed content</td>
						<td>
							<code>{"${t}.${raw body}"}</code>, HMAC-SHA256 with your webhook secret
						</td>
					</tr>
					<tr>
						<td>Tolerance</td>
						<td>30 minutes (SDK)</td>
					</tr>
					<tr>
						<td>Types</td>
						<td>
							<code>post_call_transcription</code>, <code>post_call_audio</code>,{" "}
							<code>call_initiation_failure</code>
						</td>
					</tr>
					<tr>
						<td>Expected answer</td>
						<td>
							<code>200</code>. A webhook is auto-disabled after 10 or more consecutive failures if
							the last success was more than 7 days ago (or never).
						</td>
					</tr>
				</tbody>
			</table>
			<pre>
				<code>{`import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
const elevenlabs = new ElevenLabsClient();

app.post("/api/webhooks/elevenlabs", express.text({ type: "*/*" }), async (req, res) => {
  try {
    const event = await elevenlabs.webhooks.constructEvent(
      req.body,
      req.get("elevenlabs-signature"),
      process.env.ELEVENLABS_WEBHOOK_SECRET,
    );
    if (event.type === "post_call_transcription") {
      // event.data.transcript, event.data.analysis
    }
    res.sendStatus(200);
  } catch {
    res.sendStatus(401);
  }
});`}</code>
			</pre>
			<Callout icon="💡" title="Keep the URL" color="#FF5C26">
				Because the BridgeHook URL never changes, you register it in ElevenLabs once. You do not
				need to edit the agent each time your tunnel restarts.
			</Callout>

			<AgentPrompt>{`Send a signed ElevenLabs post_call_transcription webhook to port 3000 at
/api/webhooks/elevenlabs using ELEVENLABS_WEBHOOK_SECRET from .env, and make the handler return 200.`}</AgentPrompt>
		</>
	);
}

export function VapiGuide() {
	return (
		<>
			<h1>Vapi</h1>
			<p>
				Vapi posts call events to your server URL, and some of them need an answer:{" "}
				<code>tool-calls</code>, <code>assistant-request</code>,{" "}
				<code>transfer-destination-request</code> and <code>knowledge-base-request</code>. Those
				need a <a href="#/sync-responses">sync channel</a> so your local reply goes back to Vapi.
				Informational events such as <code>status-update</code> and <code>end-of-call-report</code>{" "}
				are fine on an async channel.
			</p>
			<Checked />

			<h2>Tool calls</h2>
			<p>Vapi sends:</p>
			<pre>
				<code>{`{ "message": {
    "type": "tool-calls",
    "toolCallList": [
      { "id": "call_123", "type": "function",
        "function": { "name": "get_weather", "arguments": { "city": "Lagos" } } }
    ] } }`}</code>
			</pre>
			<p>
				Answer with HTTP <code>200</code> and one result per call. <code>result</code> (or{" "}
				<code>error</code>) must be a flat string; Vapi ignores other status codes entirely.
			</p>
			<pre>
				<code>{`app.post("/vapi/tools", express.json(), (req, res) => {
  if (req.get("authorization") !== \`Bearer \${process.env.VAPI_TOKEN}\`) return res.sendStatus(401);
  const results = req.body.message.toolCallList.map((call) => ({
    toolCallId: call.id,
    result: \`It is 31°C in \${call.function.arguments.city}.\`,
  }));
  res.json({ results });
});`}</code>
			</pre>

			<h2>Authentication</h2>
			<p>
				Vapi authenticates server URLs through credentials. The default Bearer Token credential
				sends <code>Authorization: Bearer &lt;token&gt;</code>; the legacy form sends{" "}
				<code>X-Vapi-Secret: &lt;token&gt;</code>; HMAC credentials are configurable. BridgeHook
				forwards all of these headers unchanged. When your agent sends a test tool call, pass the
				token as <code>signing_secret</code> and pick the header with <code>vapi_auth</code>.
			</p>

			<h2>Timing</h2>
			<p>
				Vapi requires <code>assistant-request</code> to be answered within 7.5 seconds end to end.
				Keep that handler fast; the round trip through BridgeHook and your browser adds network time
				on top of your code.
			</p>

			<h2>Set up</h2>
			<ol>
				<li>
					Switch the channel to sync: Dashboard → Channels → <b>Your server&apos;s reply</b>, or{" "}
					<code>set_response_mode</code> from your agent.
				</li>
				<li>
					Set the assistant&apos;s (or tool&apos;s) server URL to your channel URL plus route, for
					example <code>https://8f3a2c1d9e4b.bridgehook.dev/vapi/tools</code>.
				</li>
			</ol>

			<AgentPrompt>{`Switch my port 3000 BridgeHook URL to sync, send a Vapi tool-calls event to /vapi/tools with
the token in VAPI_TOKEN (Bearer), and fix the handler until the reply has
{"results":[{"toolCallId":…,"result":"…"}]} for the call id it sent.`}</AgentPrompt>
		</>
	);
}

export function StripeGuide() {
	return (
		<>
			<h1>Stripe</h1>
			<p>
				Point a Stripe event destination at your BridgeHook URL instead of running{" "}
				<code>stripe listen</code>. The URL survives restarts, so you register it once, and events
				sent while your machine is off are delivered in order when it is back.
			</p>
			<Checked />

			<h2>What Stripe sends</h2>
			<table>
				<tbody>
					<tr>
						<td>Header</td>
						<td>
							<code>Stripe-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code> (test events also
							carry a fake <code>v0</code>)
						</td>
					</tr>
					<tr>
						<td>Signed content</td>
						<td>
							<code>{"${t}.${raw body}"}</code>, HMAC-SHA256 with the <code>whsec_</code> secret
						</td>
					</tr>
					<tr>
						<td>Tolerance</td>
						<td>5 minutes (library default)</td>
					</tr>
					<tr>
						<td>Expected answer</td>
						<td>
							<code>2xx</code> before any slow work. Live mode retries for up to three days;
							sandboxes retry three times over a few hours. Redirects count as failures. Ordering is
							not guaranteed by Stripe.
						</td>
					</tr>
				</tbody>
			</table>

			<h2>Handler</h2>
			<pre>
				<code>{`import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, req.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(\`Webhook Error: \${err.message}\`);
  }
  if (event.type === "checkout.session.completed") {
    // fulfil the order (idempotently: track event.id)
  }
  res.sendStatus(200);
});`}</code>
			</pre>
			<Callout icon="⚠️" title="Raw body" color="#fcd34d">
				Verification fails if a JSON body parser runs first. BridgeHook forwards the body byte for
				byte, so a <code>400</code> here is your parser, not the relay.
			</Callout>

			<AgentPrompt>{`Send a signed Stripe checkout.session.completed to port 3000 at /api/webhooks/stripe with
the STRIPE_WEBHOOK_SECRET in .env. Fix the handler until it returns 200, then send it again
to check the handler is idempotent.`}</AgentPrompt>
			<p>
				After the 5-minute tolerance, a replayed Stripe event no longer verifies because it carries
				the original timestamp. Ask the agent for a fresh <code>send_test_event</code> instead.
			</p>
		</>
	);
}

export function GitHubGuide() {
	return (
		<>
			<h1>GitHub</h1>
			<p>
				Use your BridgeHook URL as a repository, organization or GitHub App webhook. GitHub gives
				your server 10 seconds to answer and does not retry failed deliveries on its own, so a queue
				that holds them while your machine is off is the difference between a missed event and a
				delivered one.
			</p>
			<Checked />

			<h2>What GitHub sends</h2>
			<table>
				<tbody>
					<tr>
						<td>Headers</td>
						<td>
							<code>X-Hub-Signature-256: sha256=&lt;hex&gt;</code>, <code>X-GitHub-Event</code>,{" "}
							<code>X-GitHub-Delivery</code>
						</td>
					</tr>
					<tr>
						<td>Signed content</td>
						<td>The raw body, HMAC-SHA256 with your webhook secret. No timestamp.</td>
					</tr>
					<tr>
						<td>Expected answer</td>
						<td>
							<code>2xx</code> within 10 seconds
						</td>
					</tr>
				</tbody>
			</table>

			<h2>Handler</h2>
			<pre>
				<code>{`import { createHmac, timingSafeEqual } from "node:crypto";

app.post("/api/webhooks/github", express.raw({ type: "*/*" }), (req, res) => {
  const expected = "sha256=" +
    createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET).update(req.body).digest("hex");
  const got = req.get("x-hub-signature-256") ?? "";
  if (got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return res.sendStatus(401);
  }
  const event = req.get("x-github-event"); // "push", "pull_request", …
  res.sendStatus(202);
});`}</code>
			</pre>

			<AgentPrompt>{`Send a signed GitHub push webhook to port 3000 at /api/webhooks/github with
GITHUB_WEBHOOK_SECRET from .env and fix the handler until it returns 2xx.`}</AgentPrompt>
			<p>
				GitHub signs no timestamp, so replaying a captured delivery still verifies, whenever you
				replay it.
			</p>
		</>
	);
}
