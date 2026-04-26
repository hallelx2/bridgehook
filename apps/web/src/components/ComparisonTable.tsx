const ROWS = [
	{
		capability: "Setup complexity",
		tunnel: "CLI install + config",
		bridgehook: "Zero-config browser",
	},
	{
		capability: "History retention",
		tunnel: "Temporary / none",
		bridgehook: "Permanent storage",
	},
	{
		capability: "Request inspection",
		tunnel: "Terminal-only",
		bridgehook: "Rich UI + JSON",
	},
	{
		capability: "Collaboration",
		tunnel: "Single machine",
		bridgehook: "Shared teams",
	},
];

export function ComparisonTable() {
	return (
		<section id="comparison" className="max-w-6xl mx-auto px-6 py-32">
			<div className="text-center mb-14">
				<h2 className="text-4xl md:text-5xl font-extrabold text-on-surface mb-4 tracking-[-0.035em]">
					Why BridgeHook?
				</h2>
				<p className="text-on-surface-variant text-lg">
					A developer-first approach to testing infrastructure.
				</p>
			</div>

			<div className="bg-surface rounded-2xl overflow-hidden border border-border">
				<table className="w-full text-left border-collapse">
					<thead>
						<tr className="bg-surface-2 border-b border-border">
							<th className="p-6 md:p-8 text-[11px] font-bold text-on-surface-variant uppercase tracking-[0.25em]">
								Capability
							</th>
							<th className="p-6 md:p-8 text-[11px] font-bold text-on-surface-muted uppercase tracking-[0.25em] text-center">
								Ngrok / Tunnels
							</th>
							<th className="p-6 md:p-8 text-[11px] font-bold text-primary uppercase tracking-[0.25em] text-center border-l border-border">
								BridgeHook
							</th>
						</tr>
					</thead>
					<tbody>
						{ROWS.map((row, i) => (
							<tr
								key={row.capability}
								className={i !== ROWS.length - 1 ? "border-b border-border-subtle" : ""}
							>
								<td className="p-6 md:p-8 text-on-surface font-semibold text-lg tracking-tight">
									{row.capability}
								</td>
								<td className="p-6 md:p-8 text-on-surface-muted text-center text-[15px]">
									{row.tunnel}
								</td>
								<td className="p-6 md:p-8 text-on-surface text-center font-semibold text-[15px] border-l border-border bg-primary-soft/40">
									{row.bridgehook}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
