/**
 * AI agents: connect a coding agent (Claude Code, Cursor, VS Code, Codex) to
 * BridgeHook's MCP server. Mints agent tokens (device kind "agent", not
 * counted as devices), shows each once with copy-paste setup, and lists or
 * revokes existing tokens.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "../components/DashboardLayout";
import { type MeDevice, me } from "../lib/me-api";

const RELAY_URL = import.meta.env.VITE_RELAY_URL || "http://localhost:8787";
const MCP_URL = `${RELAY_URL.replace(/\/$/, "")}/mcp`;

type Client = "claude" | "cursor" | "vscode" | "codex";
const CLIENTS: { id: Client; name: string }[] = [
	{ id: "claude", name: "Claude Code" },
	{ id: "cursor", name: "Cursor" },
	{ id: "vscode", name: "VS Code" },
	{ id: "codex", name: "Codex" },
];

function setupFor(client: Client, token: string): { where: string; code: string } {
	switch (client) {
		case "claude":
			return {
				where: "Run in your project",
				code: `claude mcp add --transport http bridgehook ${MCP_URL} \\\n  --header "Authorization: Bearer ${token}"`,
			};
		case "cursor":
			return {
				where: "~/.cursor/mcp.json",
				code: JSON.stringify(
					{
						mcpServers: {
							bridgehook: { url: MCP_URL, headers: { Authorization: `Bearer ${token}` } },
						},
					},
					null,
					2,
				),
			};
		case "vscode":
			return {
				where: ".vscode/mcp.json",
				code: JSON.stringify(
					{
						servers: {
							bridgehook: {
								type: "http",
								url: MCP_URL,
								headers: { Authorization: `Bearer ${token}` },
							},
						},
					},
					null,
					2,
				),
			};
		case "codex":
			return {
				where: "~/.codex/config.toml, with BRIDGEHOOK_TOKEN exported in your shell",
				code: `[mcp_servers.bridgehook]\nurl = "${MCP_URL}"\nbearer_token_env_var = "BRIDGEHOOK_TOKEN"\n\n# export BRIDGEHOOK_TOKEN=${token}`,
			};
	}
}

export function AiAgents() {
	return (
		<DashboardLayout>
			<AiAgentsView />
		</DashboardLayout>
	);
}

function AiAgentsView() {
	const [tokens, setTokens] = useState<MeDevice[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [label, setLabel] = useState("Claude Code");
	const [creating, setCreating] = useState(false);
	const [fresh, setFresh] = useState<{ token: string; label: string } | null>(null);
	const [client, setClient] = useState<Client>("claude");

	const load = useCallback(async () => {
		try {
			const d = await me.devices.list();
			setTokens(d.devices.filter((x) => x.kind === "agent"));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	async function create() {
		setCreating(true);
		setError(null);
		try {
			const r = await me.agents.create(label.trim() || "AI agent");
			setFresh({ token: r.token, label: r.label });
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setCreating(false);
		}
	}

	async function revoke(id: string) {
		try {
			await me.devices.revoke(id);
			setTokens((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	const setup = useMemo(() => (fresh ? setupFor(client, fresh.token) : null), [fresh, client]);

	return (
		<div className="p-6 max-w-4xl">
			<h1 className="text-xl font-semibold">AI agents</h1>
			<p className="text-sm text-gray-400 mt-2 max-w-2xl">
				Let your coding agent build and debug webhook handlers against your real local server. It
				can get a webhook URL for a port, fire signed Stripe, GitHub, OpenAI, ElevenLabs or Vapi
				test events, read exactly what your handler answered, and replay after a fix. Nothing to
				install: BridgeHook is a remote MCP server at{" "}
				<code className="font-mono text-gray-300">{MCP_URL}</code>.
			</p>

			{error && (
				<div className="mt-4 rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
					{error}
				</div>
			)}

			<section className="mt-6 rounded-lg border border-gray-900 bg-gray-950 p-4">
				<h2 className="text-sm font-medium text-gray-200">Connect an agent</h2>
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<input
						type="text"
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						maxLength={96}
						className="bg-gray-900 border border-gray-800 rounded px-2 py-1 text-sm w-56"
						aria-label="Token name"
						placeholder="Token name"
					/>
					<button
						type="button"
						onClick={create}
						disabled={creating}
						className="rounded bg-orange-500/90 hover:bg-orange-500 text-black text-sm font-medium px-3 py-1 disabled:opacity-50"
					>
						{creating ? "Creating…" : "Create agent token"}
					</button>
				</div>

				{fresh && setup && (
					<div className="mt-4">
						<p className="text-xs text-amber-300">
							Copy this now: the token for “{fresh.label}” is shown only once.
						</p>
						<div className="mt-3 inline-flex rounded border border-gray-800 overflow-hidden text-xs">
							{CLIENTS.map((c) => (
								<button
									key={c.id}
									type="button"
									onClick={() => setClient(c.id)}
									aria-pressed={client === c.id}
									className={`px-3 py-1 ${client === c.id ? "bg-gray-800 text-gray-100" : "text-gray-500 hover:text-gray-300"}`}
								>
									{c.name}
								</button>
							))}
						</div>
						<p className="mt-3 text-[11px] text-gray-500">{setup.where}</p>
						<CodeBlock code={setup.code} />
						<p className="mt-3 text-xs text-gray-500">
							Then ask your agent something like: “Use BridgeHook to send a signed Stripe
							checkout.session.completed to my app on port 3000 at /api/webhooks/stripe and fix
							whatever the handler gets wrong.”
						</p>
					</div>
				)}
			</section>

			<section className="mt-6">
				<h2 className="text-sm font-medium text-gray-200">Agent tokens</h2>
				{tokens === null ? (
					<p className="text-sm text-gray-500 mt-2">Loading…</p>
				) : tokens.length === 0 ? (
					<p className="text-sm text-gray-500 mt-2">No agent tokens yet.</p>
				) : (
					<ul className="mt-2 rounded-lg border border-gray-900 bg-gray-950 divide-y divide-gray-900">
						{tokens.map((t) => (
							<li key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
								<div>
									<div className="text-gray-200">{t.label}</div>
									<div className="text-[11px] text-gray-500 font-mono">
										{t.id} · last used{" "}
										{t.lastSeenAt ? new Date(t.lastSeenAt).toLocaleString() : "never"}
									</div>
								</div>
								<button
									type="button"
									onClick={() => revoke(t.id)}
									className="text-xs text-gray-500 hover:text-red-400"
								>
									Revoke
								</button>
							</li>
						))}
					</ul>
				)}
				<p className="text-[11px] text-gray-600 mt-2">
					Agent tokens only work with BridgeHook's MCP server, so they do not count toward your
					device limit. Up to 10 per account.
				</p>
			</section>
		</div>
	);
}

function CodeBlock({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="relative mt-1">
			<pre className="rounded border border-gray-800 bg-black/60 p-3 text-xs font-mono text-gray-200 overflow-x-auto whitespace-pre">
				{code}
			</pre>
			<button
				type="button"
				onClick={async () => {
					await navigator.clipboard.writeText(code);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				}}
				className="absolute top-2 right-2 text-[11px] rounded border border-gray-700 bg-gray-900 px-2 py-0.5 text-gray-300 hover:text-white"
			>
				{copied ? "Copied" : "Copy"}
			</button>
		</div>
	);
}
