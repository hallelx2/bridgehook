const ROWS = [
	{
		capability: "Setup Complexity",
		tunnel: "CLI Install + Config",
		bridgehook: "Zero-Config Browser",
	},
	{
		capability: "History Retention",
		tunnel: "Temporary / None",
		bridgehook: "Permanent Storage",
	},
	{
		capability: "Request Inspection",
		tunnel: "Terminal-only",
		bridgehook: "Rich UI + JSON",
	},
	{
		capability: "Collaboration",
		tunnel: "Single Machine",
		bridgehook: "Shared Teams",
	},
];

export function ComparisonTable() {
	return (
		<section id="comparison" className="max-w-6xl mx-auto px-8 py-32">
			<div className="text-center mb-16">
				<h2 className="text-4xl font-black text-white mb-4 tracking-tighter font-headline">
					Why BridgeHook?
				</h2>
				<p className="text-zinc-400 text-xl font-body">
					A developer-first approach to testing infrastructure.
				</p>
			</div>

			<div className="bg-[#111113] rounded-[2rem] overflow-hidden border border-white/[0.08] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] border-beam-container">
				<div className="border-beam" />
				<table className="w-full text-left border-collapse relative z-10">
					<thead>
						<tr className="bg-white/[0.04] border-b border-white/[0.08]">
							<th className="p-8 md:p-10 text-[11px] font-black text-zinc-300 uppercase tracking-[0.25em] font-label">
								Capability
							</th>
							<th className="p-8 md:p-10 text-[11px] font-black text-zinc-500 uppercase tracking-[0.25em] text-center font-label">
								Ngrok / Tunnels
							</th>
							<th className="p-8 md:p-10 text-[11px] font-black text-primary uppercase tracking-[0.25em] text-center bg-primary/[0.06] font-label">
								BridgeHook
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-white/[0.06]">
						{ROWS.map((row) => (
							<tr key={row.capability} className="hover:bg-white/[0.01] transition-colors">
								<td className="p-8 md:p-10 text-white font-bold text-lg md:text-xl tracking-tight font-headline">
									{row.capability}
								</td>
								<td className="p-8 md:p-10 text-zinc-400 text-center font-medium font-serif italic">
									{row.tunnel}
								</td>
								<td className="p-8 md:p-10 text-primary text-center font-black bg-primary/[0.04] text-lg md:text-xl font-headline">
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
