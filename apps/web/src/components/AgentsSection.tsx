import { Bot, Inbox, PhoneCall } from "lucide-react";

const DOCS = "https://docs.bridgehook.dev";

/** One line of the agent transcript in the MCP card. */
function Line({ who, children }: { who: "agent" | "tool"; children: React.ReactNode }) {
	return (
		<div className="flex gap-3">
			<span
				className={`shrink-0 w-12 text-right ${who === "agent" ? "text-primary" : "text-on-surface-faint"}`}
			>
				{who}
			</span>
			<span className="text-on-surface-variant">{children}</span>
		</div>
	);
}

/**
 * The AI-era section: what BridgeHook does for coding agents (MCP), for
 * voice and agent platforms that need a reply (sync), and for slow
 * background webhooks from AI APIs (the queue). Every claim here is a
 * shipped feature; see the matching docs pages.
 */
export function AgentsSection() {
	return (
		<section id="agents" className="max-w-7xl mx-auto px-6 py-32">
			<div className="max-w-2xl mb-14">
				<div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border text-[10px] font-bold text-primary-fixed tracking-[0.2em] uppercase mb-6">
					<Bot size={12} strokeWidth={2} />
					Built for the AI era
				</div>
				<h2 className="text-4xl md:text-5xl font-extrabold text-on-surface mb-4 tracking-[-0.03em]">
					Your agent writes the handler.
					<br />
					<span className="text-on-surface-variant">BridgeHook proves it works.</span>
				</h2>
				<p className="text-on-surface-variant text-lg leading-relaxed">
					Coding agents can write a webhook handler in seconds but cannot see what happens when a
					real provider calls it. BridgeHook gives them the other half of the loop, through your own
					running server.
				</p>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
				{/* MCP loop */}
				<div className="lg:col-span-7 bg-surface border border-border rounded-2xl p-8 md:p-10 transition-colors hover:border-border-strong">
					<div className="w-10 h-10 rounded-lg bg-primary-soft border border-primary/30 flex items-center justify-center mb-5">
						<Bot className="text-primary" size={20} strokeWidth={1.75} />
					</div>
					<h3 className="text-2xl font-extrabold text-on-surface mb-3 tracking-[-0.02em]">
						An MCP server for coding agents
					</h3>
					<p className="text-on-surface-variant text-[15px] leading-relaxed mb-6 max-w-lg">
						Claude Code, Cursor, VS Code and Codex get a permanent URL for your port, fire a signed
						Stripe, GitHub, OpenAI, ElevenLabs or Vapi webhook at your real handler, read the status
						and body it returned, fix the code and send again.
					</p>
					<div className="bg-background rounded-xl border border-border p-5 font-mono text-[12px] leading-relaxed space-y-1.5 overflow-x-auto">
						<Line who="agent">
							send_test_event stripe checkout.session.completed → /api/webhooks/stripe
						</Line>
						<Line who="tool">500 · "No signatures found matching the expected signature"</Line>
						<Line who="agent">reads the raw body before JSON parsing, sends again</Line>
						<Line who="tool">200 · {'{"received":true}'} · 14 ms</Line>
					</div>
					<div className="mt-5 bg-background rounded-xl border border-border px-5 py-3 font-mono text-[11px] text-on-surface-variant overflow-x-auto whitespace-nowrap">
						claude mcp add --transport http bridgehook https://relay.bridgehook.dev/mcp --header
						&quot;Authorization: Bearer dvc_…&quot;
					</div>
					<a
						href={`${DOCS}/#/ai-agents`}
						className="inline-block mt-5 text-[14px] font-semibold text-primary no-underline hover:underline"
					>
						Connect your agent →
					</a>
				</div>

				<div className="lg:col-span-5 grid gap-4">
					{/* Sync replies */}
					<div className="bg-surface border border-border rounded-2xl p-8 transition-colors hover:border-border-strong">
						<div className="w-10 h-10 rounded-lg bg-primary-soft border border-primary/30 flex items-center justify-center mb-5">
							<PhoneCall className="text-primary" size={20} strokeWidth={1.75} />
						</div>
						<h3 className="text-xl font-extrabold text-on-surface mb-3 tracking-[-0.02em]">
							Replies for voice and agent tools
						</h3>
						<p className="text-on-surface-variant text-[15px] leading-relaxed">
							In sync mode the sender gets your local server&apos;s answer, so Vapi tool calls,
							ElevenLabs server tools and verification challenges run against code on your laptop.
						</p>
						<a
							href={`${DOCS}/#/sync-responses`}
							className="inline-block mt-4 text-[14px] font-semibold text-primary no-underline hover:underline"
						>
							Sync responses →
						</a>
					</div>

					{/* Queue */}
					<div className="bg-surface border border-border rounded-2xl p-8 transition-colors hover:border-border-strong">
						<div className="w-10 h-10 rounded-lg bg-primary-soft border border-primary/30 flex items-center justify-center mb-5">
							<Inbox className="text-primary" size={20} strokeWidth={1.75} />
						</div>
						<h3 className="text-xl font-extrabold text-on-surface mb-3 tracking-[-0.02em]">
							Background webhooks that wait for you
						</h3>
						<p className="text-on-surface-variant text-[15px] leading-relaxed">
							OpenAI batches, ElevenLabs post-call transcripts and Stripe events can land hours
							later. Anything sent while your laptop was shut arrives in order when it opens.
						</p>
						<a
							href={`${DOCS}/#/openai`}
							className="inline-block mt-4 text-[14px] font-semibold text-primary no-underline hover:underline"
						>
							Provider guides →
						</a>
					</div>
				</div>
			</div>
		</section>
	);
}
