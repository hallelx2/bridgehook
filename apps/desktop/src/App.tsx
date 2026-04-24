import { useBridge } from "./hooks/useBridge";
import { useServices } from "./hooks/useServices";
import { Dashboard } from "./views/Dashboard";

export function App() {
	const { services } = useServices();
	const { isConnected } = useBridge();

	const activeCount = services.filter((s) => s.active && isConnected(s.id)).length;
	const totalCount = services.length;

	return (
		<div className="min-h-screen bg-gray-950 text-white flex flex-col">
			{/* Header */}
			<header className="relative flex items-center justify-between px-6 py-4 bg-gray-900/80 backdrop-blur-sm">
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-2">
						<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="none"
								xmlns="http://www.w3.org/2000/svg"
							>
								<path
									d="M2 8h4M10 8h4M8 2v4M8 10v4"
									stroke="white"
									strokeWidth="2"
									strokeLinecap="round"
								/>
							</svg>
						</div>
						<span className="text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
							BridgeHook
						</span>
					</div>
					<span className="text-[10px] font-semibold text-gray-400 bg-gray-800/80 px-2 py-0.5 rounded-full border border-gray-700/50 uppercase tracking-wider">
						Desktop
					</span>
				</div>

				{/* Connection summary */}
				{totalCount > 0 && (
					<div className="flex items-center gap-2 text-xs">
						<span
							className={`inline-block w-2 h-2 rounded-full ${
								activeCount > 0 ? "bg-green-500 animate-glow-green" : "bg-gray-500"
							}`}
						/>
						<span className="text-gray-400">
							<span
								className={
									activeCount > 0 ? "text-green-400 font-semibold" : "text-gray-500 font-semibold"
								}
							>
								{activeCount}
							</span>
							<span className="text-gray-600 mx-0.5">/</span>
							<span className="text-gray-500">{totalCount}</span>
							<span className="text-gray-600 ml-1.5">active</span>
						</span>
					</div>
				)}

				{/* Gradient border at bottom */}
				<div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
			</header>

			{/* Main Content */}
			<main className="flex-1 p-4 overflow-auto">
				<Dashboard />
			</main>
		</div>
	);
}
