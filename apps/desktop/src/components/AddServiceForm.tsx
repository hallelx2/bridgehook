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
			className="bg-gray-800 rounded-lg p-4 border border-gray-700 space-y-4"
		>
			<h3 className="text-white font-semibold">Add New Service</h3>

			<div className="grid grid-cols-3 gap-3">
				<div>
					<label className="block text-xs text-gray-400 mb-1" htmlFor="svc-name">
						Name
					</label>
					<input
						id="svc-name"
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="stripe-api"
						className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
					/>
				</div>
				<div>
					<label className="block text-xs text-gray-400 mb-1" htmlFor="svc-port">
						Port
					</label>
					<input
						id="svc-port"
						type="number"
						value={port}
						onChange={(e) => setPort(Number(e.target.value))}
						min={1}
						max={65535}
						className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
					/>
				</div>
				<div>
					<label className="block text-xs text-gray-400 mb-1" htmlFor="svc-path">
						Path
					</label>
					<input
						id="svc-path"
						type="text"
						value={path}
						onChange={(e) => setPath(e.target.value)}
						placeholder="/webhook"
						className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
					/>
				</div>
			</div>

			{error && <p className="text-red-400 text-sm">{error}</p>}

			<div className="flex gap-2 justify-end">
				<button
					type="button"
					onClick={onCancel}
					className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={loading}
					className="px-4 py-2 text-sm bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 text-white rounded font-medium transition-colors"
				>
					{loading ? "Creating..." : "Add Service"}
				</button>
			</div>
		</form>
	);
}
