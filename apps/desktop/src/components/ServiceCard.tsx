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
			? "border-l-green-500"
			: status === "disconnected"
				? "border-l-red-500"
				: "border-l-gray-600";

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
			className={`bg-gray-800/80 rounded-lg p-4 border border-gray-700/60 border-l-[3px] ${accentBorder} hover:bg-gray-800 hover:border-gray-600/60 transition-all duration-200 group`}
		>
			{/* Top row: Name + controls */}
			<div className="flex items-center justify-between mb-3">
				<div className="flex items-center gap-2.5">
					<StatusDot status={status} />
					<h3 className="text-[15px] font-semibold text-white tracking-tight">{service.name}</h3>
					<span
						className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
							status === "connected"
								? "bg-green-500/10 text-green-400 border border-green-500/20"
								: status === "disconnected"
									? "bg-red-500/10 text-red-400 border border-red-500/20"
									: "bg-gray-500/10 text-gray-500 border border-gray-500/20"
						}`}
					>
						{status}
					</span>
				</div>
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						onClick={() => onToggle(service.id)}
						className={`px-3 py-1 text-xs rounded-md font-medium transition-all duration-150 ${
							service.active
								? "bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20"
								: "bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20"
						}`}
					>
						{service.active ? "Pause" : "Resume"}
					</button>
					<button
						type="button"
						onClick={() => onRemove(service.id)}
						className="px-3 py-1 text-xs rounded-md font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all duration-150"
					>
						Remove
					</button>
				</div>
			</div>

			{/* Target URL */}
			<div className="flex items-center gap-2 mb-2">
				<span className="text-[11px] font-medium uppercase tracking-wider text-gray-500 shrink-0 w-12">
					Target
				</span>
				<span className="text-sm font-mono text-gray-200">
					localhost:{service.port}
					{service.path}
				</span>
			</div>

			{/* Webhook URL */}
			<div className="flex items-center gap-2">
				<span className="text-[11px] font-medium uppercase tracking-wider text-gray-500 shrink-0 w-12">
					URL
				</span>
				<div className="flex items-center gap-2 min-w-0 flex-1">
					<code className="text-xs text-cyan-400/90 bg-gray-900/80 px-2.5 py-1 rounded-md truncate max-w-md font-mono border border-gray-700/50">
						{webhookUrl}
					</code>
					<button
						type="button"
						onClick={handleCopy}
						className={`text-xs font-medium px-2 py-1 rounded-md transition-all duration-150 shrink-0 ${
							copied
								? "bg-green-500/10 text-green-400 border border-green-500/20"
								: "bg-gray-700/50 text-gray-400 hover:text-cyan-400 hover:bg-gray-700 border border-gray-600/50"
						}`}
					>
						{copied ? "Copied!" : "Copy"}
					</button>
				</div>
			</div>

			{/* Error message */}
			{error && (
				<div className="mt-2.5 flex items-start gap-2 bg-red-500/5 border border-red-500/10 rounded-md px-3 py-2">
					<span className="text-red-400 text-xs shrink-0 mt-px">!</span>
					<span className="text-red-400 text-xs">{error}</span>
				</div>
			)}

			{/* Created time */}
			<div className="mt-2.5 text-[10px] text-gray-600">
				Created{" "}
				{new Date(service.created_at).toLocaleDateString("en-US", {
					month: "short",
					day: "numeric",
					year: "numeric",
				})}
			</div>
		</div>
	);
}
