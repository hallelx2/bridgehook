import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export interface BridgeStatus {
	service_id: string;
	connected: boolean;
	error: string | null;
}

export function useBridge() {
	const [statuses, setStatuses] = useState<Record<string, BridgeStatus>>({});

	useEffect(() => {
		const unlisten = listen<BridgeStatus>("bridge-status", (event) => {
			setStatuses((prev) => ({
				...prev,
				[event.payload.service_id]: event.payload,
			}));
		});
		return () => {
			unlisten.then((fn_) => fn_());
		};
	}, []);

	const isConnected = (serviceId: string) => statuses[serviceId]?.connected ?? false;

	const getError = (serviceId: string) => statuses[serviceId]?.error ?? null;

	return { statuses, isConnected, getError };
}
