import { Callout } from "../components/Illustrations";

const SNIPPET = `## Webhooks: prove handlers work with BridgeHook

This app receives webhooks on port 3000:
- POST /api/webhooks/stripe   (Stripe, secret: STRIPE_WEBHOOK_SECRET)
- POST /api/webhooks/openai   (OpenAI Standard Webhooks, secret: OPENAI_WEBHOOK_SECRET)
- POST /vapi/tools            (Vapi tool calls, needs a sync reply, token: VAPI_TOKEN)

When you change a webhook handler, test it end to end with the BridgeHook MCP
server before saying it works:

1. create_webhook_url for port 3000. The same port always returns the same URL.
2. For endpoints whose reply matters (Vapi, ElevenLabs tools), set_response_mode
   to sync first.
3. send_test_event with the provider, event_type, path and signing_secret (read
   it from .env). It signs the event like the provider does.
4. Read the status and body your handler returned. Anything other than the
   expected 2xx and reply shape is a failure: fix the code and send again.
5. Send a fresh send_test_event rather than replay_event for Stripe, OpenAI and
   ElevenLabs once a few minutes have passed: their signatures expire.
6. Finish with the final status code and the event id (get_event shows the full
   request and reply).

If send_test_event says the event is queued, nothing is forwarding yet: ask me
to open the BridgeHook extension or the dashboard's browser bridge for port 3000.
Never print signing secrets in chat, logs or commits.`;

export function AgentInstructions() {
	return (
		<>
			<h1>AGENTS.md snippet</h1>
			<p>
				Coding agents read a project file at the start of every session: <code>AGENTS.md</code>{" "}
				(Codex, Cursor and others), <code>CLAUDE.md</code> (Claude Code) or{" "}
				<code>.github/copilot-instructions.md</code>. Put the webhook test loop there and the agent
				will run it whenever it touches a handler, without being asked.
			</p>
			<p>
				Connect the MCP server first (<a href="#/ai-agents">AI agents</a>), then paste this and edit
				the routes, port and secret names to match your app:
			</p>
			<pre>
				<code>{SNIPPET}</code>
			</pre>

			<Callout icon="🔐" title="About the signing secret" color="#fcd34d">
				<code>send_test_event</code> uses the secret only to sign that one request; BridgeHook does
				not store it. The signed request is kept in your event history like any webhook. Use
				test-mode secrets (a Stripe sandbox <code>whsec_</code>, a separate OpenAI test endpoint)
				for agent sessions, never production ones.
			</Callout>

			<h2>Why each line is there</h2>
			<ul>
				<li>
					<strong>The route list</strong> tells the agent which provider, path and secret belong
					together, so it does not guess.
				</li>
				<li>
					<strong>&quot;Before saying it works&quot;</strong> makes the test part of done, not an
					optional extra.
				</li>
				<li>
					<strong>Sync first</strong> for tool endpoints, because their reply is the thing under
					test.
				</li>
				<li>
					<strong>Fresh events, not replays</strong>, because Stripe and OpenAI reject signatures
					older than 5 minutes and ElevenLabs older than 30.
				</li>
				<li>
					<strong>The queued case</strong> gives the agent the right thing to ask you when nothing
					is forwarding.
				</li>
			</ul>
		</>
	);
}
