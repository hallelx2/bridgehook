import { useState } from "react";

interface ImportFormProps {
	onImport: (webhookUrl: string, name: string, port: number, path: string) => Promise<void>;
	onCancel: () => void;
}

export function ImportForm({ onImport, onCancel }: ImportFormProps) {
	const [webhookUrl, setWebhookUrl] = useState("");
	const [name, setName] = useState("");
	const [port, setPort] = useState(3000);
	const [path, setPath] = useState("/");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!webhookUrl.includes("/hook/")) {
			setError("Paste webhook URL from extension");
			return;
		}
		if (!name.trim()) {
			setError("Name is required");
			return;
		}
		setLoading(true);
		setError(null);
		try {
			await onImport(webhookUrl.trim(), name.trim(), port, path.trim());
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-2.5">
			<div className="flex items-center justify-between">
				<span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">
					Import Channel
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
				value={webhookUrl}
				onChange={(e) => setWebhookUrl(e.target.value)}
				placeholder="Paste webhook URL..."
				className="w-full bg-gray-900 border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-cyan-400 font-mono placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
			/>

			<input
				type="text"
				value={name}
				onChange={(e) => setName(e.target.value)}
				placeholder="Service name"
				className="w-full bg-gray-900 border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
			/>

			<div className="flex gap-2">
				<input
					type="number"
					value={port}
					onChange={(e) => setPort(Number(e.target.value))}
					min={1}
					max={65535}
					className="w-20 bg-gray-900 border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500/50"
				/>
				<input
					type="text"
					value={path}
					onChange={(e) => setPath(e.target.value)}
					placeholder="/"
					className="flex-1 bg-gray-900 border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
				/>
			</div>

			<p className="text-[9px] text-gray-600">
				Takes over the extension channel. Pause it in the extension after importing.
			</p>

			{error && <p className="text-red-400 text-[10px]">{error}</p>}

			<button
				type="submit"
				disabled={loading}
				className="w-full py-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white rounded-md transition-all"
			>
				{loading ? "Importing..." : "Take Over"}
			</button>
		</form>
	);
}
