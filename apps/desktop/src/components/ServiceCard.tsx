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
		<div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-2">
					<StatusDot status={status} />
					<h3 className="font-semibold text-white">{service.name}</h3>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => onToggle(service.id)}
						className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
							service.active
								? "bg-yellow-600 hover:bg-yellow-700 text-white"
								: "bg-green-600 hover:bg-green-700 text-white"
						}`}
					>
						{service.active ? "Pause" : "Resume"}
					</button>
					<button
						type="button"
						onClick={() => onRemove(service.id)}
						className="px-3 py-1 text-xs rounded-full font-medium bg-red-900 hover:bg-red-800 text-red-200 transition-colors"
					>
						Remove
					</button>
				</div>
			</div>

			<div className="text-sm text-gray-400 space-y-1">
				<div>
					<span className="text-gray-500">Target:</span>{" "}
					<span className="text-gray-300">
						localhost:{service.port}
						{service.path}
					</span>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-gray-500">URL:</span>
					<code className="text-xs text-cyan-400 bg-gray-900 px-2 py-0.5 rounded truncate max-w-md">
						{webhookUrl}
					</code>
					<button
						type="button"
						onClick={handleCopy}
						className="text-xs text-cyan-500 hover:text-cyan-400 transition-colors whitespace-nowrap"
					>
						{copied ? "Copied!" : "Copy"}
					</button>
				</div>
				{error && <div className="text-red-400 text-xs mt-1">Error: {error}</div>}
			</div>
		</div>
	);
}
