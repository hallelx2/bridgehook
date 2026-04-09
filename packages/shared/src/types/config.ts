export interface ServiceConfig {
	name: string;
	port: number;
	path: string;
}

export interface BridgehookConfig {
	services: ServiceConfig[];
}
