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
			const service = await invoke<Service>("add_service", {
				name,
				port,
				path,
			});
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
			const nowActive = await invoke<boolean>("toggle_service", {
				serviceId,
			});
			await refresh();
			return nowActive;
		},
		[refresh],
	);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return { services, loading, addService, removeService, toggleService, refresh };
}
