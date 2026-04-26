export interface CreateChannelRequest {
	/** Hex-encoded ECDSA P-256 public key (raw uncompressed, 130 hex chars). */
	publicKey: string;
	port: number;
	allowedPaths?: string[];
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
