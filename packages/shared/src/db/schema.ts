import { integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const channels = pgTable("channels", {
	id: varchar("id", { length: 24 }).primaryKey(),
	// One of `publicKey` or `secretHash` is populated, never both.
	// - publicKey: hex-encoded ECDSA P-256 public key (130 chars). Modern clients.
	//   Auth is per-request signature verification.
	// - secretHash: SHA-256 hex of a shared secret (64 chars). Legacy clients
	//   (desktop Rust backend, browser extension) that haven't been ported to
	//   asymmetric signing yet. Auth is bearer-token + constant-time compare.
	publicKey: text("public_key"),
	secretHash: text("secret_hash"),
	port: integer("port").notNull().default(3000),
	allowedPaths: text("allowed_paths").notNull().default("[]"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const events = pgTable("events", {
	id: varchar("id", { length: 32 }).primaryKey(),
	channelId: varchar("channel_id", { length: 24 })
		.notNull()
		.references(() => channels.id, { onDelete: "cascade" }),
	method: varchar("method", { length: 10 }).notNull(),
	path: text("path").notNull(),
	requestHeaders: text("request_headers").notNull().default("{}"),
	requestBody: text("request_body"),
	responseStatus: integer("response_status"),
	responseHeaders: text("response_headers"),
	responseBody: text("response_body"),
	latencyMs: integer("latency_ms"),
	error: text("error"),
	receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ChannelRow = typeof channels.$inferSelect;
export type NewChannelRow = typeof channels.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
