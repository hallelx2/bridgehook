import {
	ArchitectureDiagram,
	DataFlowDiagram,
	ResponsibilityDiagram,
} from "../components/FlowDiagram";

export function Architecture() {
	return (
		<>
			<h1>Architecture</h1>
			<p>
				BridgeHook is one pnpm monorepo: the relay, the dashboard, the extension and these docs.
			</p>

			<h2>System Overview</h2>
			<ArchitectureDiagram />

			<h2>Data Flow</h2>
			<p>Every webhook takes the same five steps:</p>
			<DataFlowDiagram />

			<h2>Server-Side vs Client-Side</h2>
			<p>What runs on the relay, and what runs in your browser:</p>
			<ResponsibilityDiagram />

			<h2>Monorepo Structure</h2>
			<pre>
				<code>{`bridgehook/
├── packages/shared/     Types, constants, plans, Drizzle schema
├── relay/               Cloudflare Worker: intake, API, MCP server, D1, Durable Objects
├── apps/web/            Landing page, dashboard and the no-install browser bridge (React)
├── apps/extension/      Chrome extension (Manifest V3 service worker)
├── apps/desktop/        Desktop app (Tauri), in development
└── docs/                This site, plus llms.txt generated from it`}</code>
			</pre>

			<h2>Tech Stack</h2>
			<table>
				<thead>
					<tr>
						<th>Component</th>
						<th>Technology</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Relay</td>
						<td>Cloudflare Workers, Hono</td>
					</tr>
					<tr>
						<td>Storage</td>
						<td>Cloudflare D1 (SQLite) with Drizzle ORM; KV for rate limits and daily counters</td>
					</tr>
					<tr>
						<td>Live state</td>
						<td>Durable Objects: one per channel (sync waits), one per user (the SSE stream)</td>
					</tr>
					<tr>
						<td>Auth</td>
						<td>Better-Auth; ECDSA P-256 channel keys via WebCrypto</td>
					</tr>
					<tr>
						<td>MCP</td>
						<td>Model Context Protocol SDK, stateless Streamable HTTP</td>
					</tr>
					<tr>
						<td>Web app and docs</td>
						<td>Vite, React, Tailwind CSS, on Cloudflare Pages</td>
					</tr>
					<tr>
						<td>Extension</td>
						<td>Plain JavaScript, Manifest V3</td>
					</tr>
					<tr>
						<td>Tooling</td>
						<td>pnpm workspaces, TypeScript, Biome, Vitest</td>
					</tr>
				</tbody>
			</table>

			<h2>Where the work happens</h2>
			<p>
				The relay does little per webhook: validate, store, notify. The expensive part, waiting on
				your handler, happens in your browser, and a sync wait parks in a Durable Object rather than
				a running Worker. Storage stays bounded because each plan&apos;s event history is swept on a
				schedule.
			</p>
		</>
	);
}
