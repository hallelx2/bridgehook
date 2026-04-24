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
		<form onSubmit={handleSubmit} className="space-y-2.5">
			<div className="flex items-center justify-between">
				<span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
					New Service
				</span>
				<button
					type="button"
					onClick={onCancel}
					className="text-gray-600 hover:text-gray-400 text-xs"
				>
					&times;
				</button>
			</div>

			<input
				type="text"
				value={name}
				onChange={(e) => setName(e.target.value)}
				placeholder="Service name (e.g. stripe-api)"
				className="w-full bg-gray-900 border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50"
			/>

			<div className="flex gap-2">
				<input
					type="number"
					value={port}
					onChange={(e) => setPort(Number(e.target.value))}
					min={1}
					max={65535}
					className="w-20 bg-gray-900 border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500/50"
					placeholder="Port"
				/>
				<input
					type="text"
					value={path}
					onChange={(e) => setPath(e.target.value)}
					placeholder="/webhook"
					className="flex-1 bg-gray-900 border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50"
				/>
			</div>

			{error && <p className="text-red-400 text-[10px]">{error}</p>}

			<button
				type="submit"
				disabled={loading}
				className="w-full py-1.5 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 text-white rounded-md transition-all"
			>
				{loading ? "Creating..." : "Add Service"}
			</button>
		</form>
	);
}
