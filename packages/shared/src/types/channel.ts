export interface Channel {
	id: string;
	secretHash: string;
	createdAt: string;
	expiresAt: string;
	connectedClients: number;
}

export interface WebhookEvent {
	id: string;
	method: string;
	path: string;
	headers: Record<string, string>;
	body: string;
	receivedAt: string;
}

export interface WebhookResponse {
	eventId: string;
	status: number;
	headers: Record<string, string>;
	body: string;
}

export interface Service {
	id: string;
	name: string;
	port: number;
	path: string;
	channelId: string;
	active: boolean;
	createdAt: string;
}
