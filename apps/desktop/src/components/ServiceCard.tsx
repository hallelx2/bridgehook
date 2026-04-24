import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useState } from "react";
import type { Service } from "../hooks/useServices";
import { StatusDot } from "./StatusDot";

interface ServiceCardProps {
	service: Service;
	connected: boolean;
	error: string | null;
	onToggle: (serviceId: string) => void;
	onRemove: (serviceId: string) => void;
}

export function ServiceCard({ service, connected, error, onToggle, onRemove }: ServiceCardProps) {
	const [copied, setCopied] = useState(false);
	const webhookUrl = `https://bridgehook-relay.halleluyaholudele.workers.dev/hook/${service.channel_id}`;

	const status = !service.active ? "inactive" : connected ? "connected" : "disconnected";

	const accentBorder =
		status === "connected"
			? "border-l-emerald-500"
			: status === "disconnected"
				? "border-l-red-500"
				: "border-l-gray-600";

	const statusLabel =
		status === "connected"
			? { text: "LIVE", cls: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20" }
			: status === "disconnected"
				? { text: "DOWN", cls: "bg-red-500/15 text-red-400 ring-1 ring-red-500/20" }
				: { text: "PAUSED", cls: "bg-gray-500/15 text-gray-400 ring-1 ring-gray-500/20" };

	const handleCopy = async () => {
		try {
			await writeText(webhookUrl);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error("Failed to copy:", err);
		}
	};

	return (
		<div
			className={`bg-gray-900/70 rounded-xl p-4 border border-gray-800/80 border-l-[3px] ${accentBorder} transition-all duration-200 hover:bg-gray-900/90 hover:border-gray-700/80 animate-fade-in-up`}
		>
			{/* Header row */}
			<div className="flex items-center justify-between mb-3">
				<div className="flex items-center gap-2.5">
					<StatusDot status={status} />
					<h3 className="font-semibold text-white text-[15px]">{service.name}</h3>
					<span
						className={`text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${statusLabel.cls}`}
					>
						{statusLabel.text}
					</span>
				</div>
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						onClick={() => onToggle(service.id)}
						className={`px-3 py-1 text-[11px] rounded-lg font-medium transition-all duration-200 ring-1 ${
							service.active
								? "ring-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
								: "ring-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
						}`}
					>
						{service.active ? "Pause" : "Resume"}
					</button>
					<button
						type="button"
						onClick={() => onRemove(service.id)}
						className="px-3 py-1 text-[11px] rounded-lg font-medium ring-1 ring-red-500/20 text-red-400 hover:bg-red-500/10 transition-all duration-200"
					>
						Remove
					</button>
				</div>
			</div>

			{/* Details */}
			<div className="space-y-2">
				<div className="flex items-center gap-3 text-sm">
					<span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider w-14 shrink-0">
						Target
					</span>
					<span className="text-gray-300 font-mono text-[13px]">
						localhost:{service.port}
						{service.path}
					</span>
				</div>

				<div className="flex items-center gap-3">
					<span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider w-14 shrink-0">
						URL
					</span>
					<div className="flex items-center gap-2 flex-1 min-w-0">
						<code className="text-[11px] text-cyan-400/90 bg-gray-950/80 px-2.5 py-1.5 rounded-lg ring-1 ring-gray-800 truncate font-mono flex-1">
							{webhookUrl}
						</code>
						<button
							type="button"
							onClick={handleCopy}
							className={`px-3 py-1.5 text-[11px] rounded-lg font-medium ring-1 transition-all duration-200 whitespace-nowrap ${
								copied
									? "ring-emerald-500/40 text-emerald-400 bg-emerald-500/10"
									: "ring-gray-700 text-gray-400 hover:text-cyan-400 hover:ring-cyan-500/30 hover:bg-cyan-500/5"
							}`}
						>
							{copied ? "Copied!" : "Copy"}
						</button>
					</div>
				</div>
			</div>

			{/* Error banner */}
			{error && (
				<div className="mt-3 px-3 py-2 rounded-lg bg-red-500/5 ring-1 ring-red-500/20 text-red-400 text-xs flex items-center gap-2">
					<span className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 text-[10px] font-bold shrink-0">
						!
					</span>
					{error}
				</div>
			)}
		</div>
	);
}
