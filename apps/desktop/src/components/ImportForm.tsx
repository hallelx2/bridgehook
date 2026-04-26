import { useId, useState } from "react";

interface ImportFormProps {
	onImport: (webhookUrl: string, name: string, port: number, path: string) => Promise<void>;
	onCancel: () => void;
}

export function ImportForm({ onImport, onCancel }: ImportFormProps) {
	const urlId = useId();
	const nameId = useId();
	const portId = useId();
	const pathId = useId();
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

	const labelCls = "block text-micro font-semibold text-fg-faint uppercase tracking-[0.18em] mb-1";
	const inputCls =
		"w-full bg-ink-0 border border-edge rounded-sm px-2 h-7 text-caption text-fg placeholder-fg-ghost focus:outline-none focus:border-uranium/40 transition-colors tabular";

	return (
		<form onSubmit={handleSubmit} className="space-y-2.5">
			<div className="flex items-center justify-between">
				<span className="text-micro font-semibold text-fg-muted uppercase tracking-[0.18em]">
					&gt; import channel
				</span>
				<button
					type="button"
					onClick={onCancel}
					aria-label="Cancel"
					className="text-fg-ghost hover:text-fg-muted text-body w-4 h-4 flex items-center justify-center"
				>
					×
				</button>
			</div>

			<div>
				<label htmlFor={urlId} className={labelCls}>
					webhook url
				</label>
				<input
					id={urlId}
					type="text"
					value={webhookUrl}
					onChange={(e) => setWebhookUrl(e.target.value)}
					placeholder="https://…/hook/abc123"
					className={`${inputCls} text-uranium`}
				/>
			</div>

			<div>
				<label htmlFor={nameId} className={labelCls}>
					name
				</label>
				<input
					id={nameId}
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="stripe-api"
					className={inputCls}
				/>
			</div>

			<div className="flex gap-2">
				<div className="w-20">
					<label htmlFor={portId} className={labelCls}>
						port
					</label>
					<input
						id={portId}
						type="number"
						value={port}
						onChange={(e) => setPort(Number(e.target.value))}
						min={1}
						max={65535}
						className={inputCls}
					/>
				</div>
				<div className="flex-1">
					<label htmlFor={pathId} className={labelCls}>
						path
					</label>
					<input
						id={pathId}
						type="text"
						value={path}
						onChange={(e) => setPath(e.target.value)}
						placeholder="/"
						className={inputCls}
					/>
				</div>
			</div>

			<p className="text-micro text-fg-faint leading-relaxed">
				takes over the extension channel — remember to pause it in the extension after importing.
			</p>

			{error && (
				<p className="text-err text-caption tabular">
					<span className="font-bold mr-1">!</span>
					{error}
				</p>
			)}

			<button
				type="submit"
				disabled={loading}
				className="w-full h-8 text-caption font-semibold uppercase tracking-wider bg-uranium hover:bg-uranium-dim disabled:opacity-30 text-uranium-ink rounded-sm transition-colors"
			>
				{loading ? "importing…" : "→ take over"}
			</button>
		</form>
	);
}
