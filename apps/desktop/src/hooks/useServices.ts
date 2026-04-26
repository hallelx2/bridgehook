import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export interface Service {
	id: string;
	name: string;
	port: number;
	path: string;
	channel_id: string;
	secret: string;
	active: boolean;
	created_at: string;
	// Config — all optional (backfilled by migration to NULL / defaults)
	path_rewrite: string | null;
	injected_headers: string | null;
	timeout_ms: number | null;
	retry_count: number;
	retry_delay_ms: number;
	environments: string | null;
	active_environment: string | null;
	signing_provider: string | null;
	signing_secret: string | null;
	mock_response: string | null;
	notify_on_event: boolean;
}

export interface PortProbe {
	port: number;
	alive: boolean;
	status: number;
	server: string | null;
}

export function useServices() {
	const [services, setServices] = useState<Service[]>([]);
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(async () => {
		try {
			const result = await invoke<Service[]>("list_services");
			setServices(result);
		} catch (err) {
			console.error("Failed to list services:", err);
		} finally {
			setLoading(false);
		}
	}, []);

	const addService = useCallback(
		async (name: string, port: number, path: string) => {
			const service = await invoke<Service>("add_service", { name, port, path });
			await refresh();
			return service;
		},
		[refresh],
	);

	const removeService = useCallback(
		async (serviceId: string) => {
			await invoke("remove_service", { serviceId });
			await refresh();
		},
		[refresh],
	);

	const toggleService = useCallback(
		async (serviceId: string) => {
			const nowActive = await invoke<boolean>("toggle_service", { serviceId });
			await refresh();
			return nowActive;
		},
		[refresh],
	);

	const updateService = useCallback(
		async (service: Service) => {
			const updated = await invoke<Service>("update_service", { service });
			await refresh();
			return updated;
		},
		[refresh],
	);

	const scanPorts = useCallback(async () => invoke<PortProbe[]>("scan_ports"), []);
	const autoDetect = useCallback(async () => invoke<PortProbe[]>("auto_detect"), []);

	const importFromExtension = useCallback(
		async (webhookUrl: string, name: string, port: number, path: string) => {
			const service = await invoke<Service>("import_from_extension", {
				webhookUrl,
				name,
				port,
				path,
			});
			await refresh();
			return service;
		},
		[refresh],
	);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return {
		services,
		loading,
		addService,
		removeService,
		toggleService,
		updateService,
		scanPorts,
		autoDetect,
		importFromExtension,
		refresh,
	};
}
