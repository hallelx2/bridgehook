/**
 * Channels list page. Owned channels with metadata, last activity,
 * and inline rename. Webhook URL copy button per row.
 */
import { useEffect, useState } from "react";
import { DashboardLayout } from "../components/DashboardLayout";
import { type MeChannel, me } from "../lib/me-api";

export function ChannelsList() {
	return (
		<DashboardLayout>
			<ChannelsView />
		</DashboardLayout>
	);
}

function ChannelsView() {
	const [channels, setChannels] = useState<MeChannel[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draftLabel, setDraftLabel] = useState("");

	useEffect(() => {
		me.channels
			.list()
			.then((d) => setChannels(d.channels))
			.catch((err) => setError(err instanceof Error ? err.message : String(err)));
	}, []);

	async function saveLabel(id: string) {
		try {
			const updated = await me.channels.patch(id, { label: draftLabel.trim() || null });
			setChannels((prev) =>
				prev ? prev.map((c) => (c.id === id ? { ...c, label: updated.label } : c)) : prev,
			);
			setEditingId(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function deleteChannel(id: string) {
		if (!window.confirm(`Delete channel ${id}? Events are deleted with it.`)) return;
		try {
			await me.channels.remove(id);
			setChannels((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	if (error) {
		return (
			<div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
				{error}
			</div>
		);
	}
	if (!channels)
		return <div className="text-sm text-gray-500 py-12 text-center font-mono">loading…</div>;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">Channels</h1>
				<div className="text-xs text-gray-500 font-mono">{channels.length} owned</div>
			</div>

			{channels.length === 0 ? (
				<div className="rounded-lg border border-gray-900 bg-gray-950 p-8 text-center">
					<p className="text-sm text-gray-400">No channels yet.</p>
					<p className="text-xs text-gray-500 mt-1">
						Pair a device (extension or desktop) and start a bridge to create one.
					</p>
				</div>
			) : (
				<div className="rounded-lg border border-gray-900 bg-gray-950 overflow-hidden">
					<div className="grid grid-cols-[minmax(0,1.5fr)_72px_minmax(0,2fr)_72px_88px_64px] gap-3 px-4 py-2 border-b border-gray-900 text-[10px] uppercase tracking-wider text-gray-500">
						<div>Channel</div>
						<div>Port</div>
						<div>Webhook URL</div>
						<div>24h</div>
						<div>Last event</div>
						<div className="text-right">Actions</div>
					</div>
					<ul>
						{channels.map((c) => (
							<li
								key={c.id}
								className="grid grid-cols-[minmax(0,1.5fr)_72px_minmax(0,2fr)_72px_88px_64px] gap-3 px-4 py-3 border-b border-gray-900 items-center text-sm hover:bg-gray-900/40"
							>
								<div className="min-w-0">
									{editingId === c.id ? (
										<form
											onSubmit={(e) => {
												e.preventDefault();
												saveLabel(c.id);
											}}
										>
											<input
												type="text"
												// biome-ignore lint/a11y/noAutofocus: inline edit affordance — focus on entry is the expected UX
												autoFocus
												value={draftLabel}
												onChange={(e) => setDraftLabel(e.target.value)}
												onBlur={() => saveLabel(c.id)}
												className="bg-gray-900 border border-cyan-500 rounded px-2 py-0.5 text-sm font-mono w-full"
												placeholder={c.id}
											/>
										</form>
									) : (
										<button
											type="button"
											onClick={() => {
												setDraftLabel(c.label ?? "");
												setEditingId(c.id);
											}}
											className="font-mono text-gray-200 truncate text-left hover:text-cyan-400 w-full"
										>
											{c.label || c.id}
										</button>
									)}
									<div className="text-[11px] text-gray-500 mt-0.5 font-mono">
										{c.id}
										{c.device ? ` · ${c.device.label}` : ""}
									</div>
								</div>
								<div className="font-mono text-xs text-gray-300 tabular-nums">{c.port}</div>
								<div className="min-w-0">
									<CopyButton text={c.webhookUrl} />
								</div>
								<div className="font-mono text-xs text-gray-300 tabular-nums">
									{c.stats.count24h}
								</div>
								<div className="text-xs text-gray-500">
									{c.stats.lastEventAt ? formatRelative(c.stats.lastEventAt) : "—"}
								</div>
								<div className="text-right">
									<button
										type="button"
										onClick={() => deleteChannel(c.id)}
										className="text-xs text-gray-500 hover:text-red-400"
										aria-label="Delete channel"
									>
										Delete
									</button>
								</div>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		} catch {
			/* noop */
		}
	}

	return (
		<button
			type="button"
			onClick={copy}
			className="text-xs font-mono text-gray-400 hover:text-cyan-400 truncate inline-block w-full text-left"
			title={text}
		>
			{copied ? "✓ copied" : text}
		</button>
	);
}

function formatRelative(iso: string): string {
	const ms = Date.now() - Date.parse(iso);
	if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s`;
	if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
	if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
	return `${Math.floor(ms / 86_400_000)}d`;
}
