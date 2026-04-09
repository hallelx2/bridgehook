export interface CreateChannelRequest {
	secretHash: string;
}

export interface CreateChannelResponse {
	channelId: string;
	expiresAt: string;
}

export interface SendResponseRequest {
	eventId: string;
	status: number;
	headers: Record<string, string>;
	body: string;
}

export interface RelayError {
	error: string;
	code: string;
}
