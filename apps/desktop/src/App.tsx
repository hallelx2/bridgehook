import { Dashboard } from "./views/Dashboard";

export function App() {
	return (
		<div className="min-h-screen bg-gray-950 text-white flex flex-col">
			{/* Header */}
			<header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900/50">
				<div className="flex items-center gap-2">
					<span className="text-lg font-bold text-cyan-400">BridgeHook</span>
					<span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
						Desktop
					</span>
				</div>
			</header>

			{/* Main Content */}
			<main className="flex-1 p-4 overflow-auto">
				<Dashboard />
			</main>
		</div>
	);
}
