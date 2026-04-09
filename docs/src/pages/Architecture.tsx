import {
	ArchitectureDiagram,
	DataFlowDiagram,
	ResponsibilityDiagram,
} from "../components/FlowDiagram";

export function Architecture() {
	return (
		<>
			<h1>Architecture</h1>
			<p>BridgeHook is a pnpm monorepo with clearly separated concerns.</p>

			<h2>System Overview</h2>
			<ArchitectureDiagram />

			<h2>Data Flow</h2>
			<p>Every webhook goes through this 5-step journey:</p>
			<DataFlowDiagram />

			<h2>Server-Side vs Client-Side</h2>
			<p>
				BridgeHook strictly separates what runs on the server (relay) vs what runs in your browser:
			</p>
			<ResponsibilityDiagram />

			<h2>Monorepo Structure</h2>
			<pre>
				<code>{`bridgehook/
├── packages/shared/     Types, constants, Drizzle schema
├── apps/web/            Landing page + Dashboard (React)
├── apps/desktop/        System tray app (Tauri, Phase 2)
├── relay/               Cloudflare Worker + Neon
└── docs/                Documentation (this site)`}</code>
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
						<td>Relay server</td>
						<td>Cloudflare Workers</td>
					</tr>
					<tr>
						<td>Database</td>
						<td>Neon PostgreSQL + Drizzle ORM</td>
					</tr>
					<tr>
						<td>Web app</td>
						<td>Vite + React + Tailwind CSS</td>
					</tr>
					<tr>
						<td>Desktop app</td>
						<td>Tauri v2 + Rust (Phase 2)</td>
					</tr>
					<tr>
						<td>Shared types</td>
						<td>TypeScript + Drizzle schema</td>
					</tr>
					<tr>
						<td>Monorepo</td>
						<td>pnpm workspaces</td>
					</tr>
					<tr>
						<td>Linting</td>
						<td>Biome</td>
					</tr>
				</tbody>
			</table>

			<h2>Cost at Scale</h2>
			<table>
				<thead>
					<tr>
						<th>Users</th>
						<th>Monthly Requests</th>
						<th>Cost</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>1–100</td>
						<td>~50K</td>
						<td>$0 (free tier)</td>
					</tr>
					<tr>
						<td>100–1K</td>
						<td>~500K</td>
						<td>$0 (free tier)</td>
					</tr>
					<tr>
						<td>1K–10K</td>
						<td>~5M</td>
						<td>~$5/month</td>
					</tr>
					<tr>
						<td>10K+</td>
						<td>~50M+</td>
						<td>~$50/month</td>
					</tr>
				</tbody>
			</table>
			<p>
				Events auto-expire in 24 hours, so the database never grows unboundedly. The relay is
				stateless. The browser does all the compute-heavy forwarding. This architecture scales
				cheaply.
			</p>
		</>
	);
}
