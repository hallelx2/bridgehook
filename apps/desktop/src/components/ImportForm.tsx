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
			setError("Paste the webhook URL from the extension (e.g. https://.../hook/abc123)");
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
		<form
			onSubmit={handleSubmit}
			className="bg-gray-800 rounded-lg p-4 border border-cyan-800 space-y-4"
		>
			<h3 className="text-white font-semibold flex items-center gap-2">
				<span className="text-cyan-400">Import from Extension</span>
				<span className="text-xs text-gray-500 font-normal">— take over an existing channel</span>
			</h3>

			<div>
				<label className="block text-xs text-gray-400 mb-1" htmlFor="import-url">
					Webhook URL from extension
				</label>
				<input
					id="import-url"
					type="text"
					value={webhookUrl}
					onChange={(e) => setWebhookUrl(e.target.value)}
					placeholder="https://bridgehook-relay.../hook/f1586acae33f"
					className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-cyan-400 font-mono placeholder-gray-600 focus:outline-none focus:border-cyan-500"
				/>
			</div>

			<div className="grid grid-cols-3 gap-3">
				<div>
					<label className="block text-xs text-gray-400 mb-1" htmlFor="import-name">
						Name
					</label>
					<input
						id="import-name"
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="stripe-api"
						className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
					/>
				</div>
				<div>
					<label className="block text-xs text-gray-400 mb-1" htmlFor="import-port">
						Port
					</label>
					<input
						id="import-port"
						type="number"
						value={port}
						onChange={(e) => setPort(Number(e.target.value))}
						min={1}
						max={65535}
						className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
					/>
				</div>
				<div>
					<label className="block text-xs text-gray-400 mb-1" htmlFor="import-path">
						Path
					</label>
					<input
						id="import-path"
						type="text"
						value={path}
						onChange={(e) => setPath(e.target.value)}
						placeholder="/"
						className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
					/>
				</div>
			</div>

			<p className="text-xs text-gray-500">
				After importing, pause or remove this service from the extension. The desktop app will take
				over — same URL, but you can close your browser.
			</p>

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
					{loading ? "Importing..." : "Take Over Channel"}
				</button>
			</div>
		</form>
	);
}
