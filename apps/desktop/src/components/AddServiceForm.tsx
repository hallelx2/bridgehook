import { useState } from "react";

interface AddServiceFormProps {
	onAdd: (name: string, port: number, path: string) => Promise<void>;
	onCancel: () => void;
}

export function AddServiceForm({ onAdd, onCancel }: AddServiceFormProps) {
	const [name, setName] = useState("");
	const [port, setPort] = useState(3000);
	const [path, setPath] = useState("/webhook");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) {
			setError("Name is required");
			return;
		}
		setLoading(true);
		setError(null);
		try {
			await onAdd(name.trim(), port, path.trim());
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	};

	return (
		<form
			onSubmit={handleSubmit}
			className="bg-gray-800/80 rounded-lg p-5 border border-gray-700/60 space-y-5"
		>
			<div className="flex items-center gap-2.5">
				<div className="w-6 h-6 rounded-md bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
					<span className="text-cyan-400 text-sm font-bold">+</span>
				</div>
				<h3 className="text-white font-semibold text-[15px] tracking-tight">Add New Service</h3>
			</div>

			<div className="grid grid-cols-3 gap-4">
				<div>
					<label className="block text-xs font-medium text-gray-300 mb-1.5" htmlFor="svc-name">
						Service Name
					</label>
					<input
						id="svc-name"
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="stripe-api"
						className="w-full bg-gray-900/80 border border-gray-600/60 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50 transition-all duration-150"
					/>
					<p className="text-[10px] text-gray-500 mt-1">A short name to identify this service</p>
				</div>
				<div>
					<label className="block text-xs font-medium text-gray-300 mb-1.5" htmlFor="svc-port">
						Port
					</label>
					<input
						id="svc-port"
						type="number"
						value={port}
						onChange={(e) => setPort(Number(e.target.value))}
						min={1}
						max={65535}
						className="w-full bg-gray-900/80 border border-gray-600/60 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50 transition-all duration-150"
					/>
					<p className="text-[10px] text-gray-500 mt-1">Local server port (1-65535)</p>
				</div>
				<div>
					<label className="block text-xs font-medium text-gray-300 mb-1.5" htmlFor="svc-path">
						Path
					</label>
					<input
						id="svc-path"
						type="text"
						value={path}
						onChange={(e) => setPath(e.target.value)}
						placeholder="/webhook"
						className="w-full bg-gray-900/80 border border-gray-600/60 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50 transition-all duration-150"
					/>
					<p className="text-[10px] text-gray-500 mt-1">Endpoint path on your server</p>
				</div>
			</div>

			{error && (
				<div className="flex items-center gap-2 bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2">
					<span className="text-red-400 text-xs shrink-0">!</span>
					<p className="text-red-400 text-sm">{error}</p>
				</div>
			)}

			<div className="flex gap-2 justify-end pt-1">
				<button
					type="button"
					onClick={onCancel}
					className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/50 transition-all duration-150"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={loading}
					className="px-5 py-2 text-sm bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:from-gray-600 disabled:to-gray-600 text-white rounded-lg font-medium transition-all duration-150 shadow-lg shadow-cyan-500/10 disabled:shadow-none"
				>
					{loading ? "Creating..." : "Add Service"}
				</button>
			</div>
		</form>
	);
}
