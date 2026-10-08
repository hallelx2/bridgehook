import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	check,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { nowMs, user } from "./auth-schema.js";

export * from "./auth-schema.js";

/**
 * BridgeHook devices — extension/desktop/CLI instances paired to an account.
 * Token issued once at pairing; only its SHA-256 hash is stored.
 */
export const devices = sqliteTable(
	"devices",
	{
		id: text("id").primaryKey(), // 'dev_' + 20-char random
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(), // 'extension' | 'desktop' | 'cli' | 'web'
		label: text("label").notNull(),
		tokenHash: text("token_hash").notNull(),
		os: text("os"),
		userAgent: text("user_agent"),
		lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(t) => [
		index("devices_user_active").on(t.userId).where(sql`revoked_at IS NULL`),
		uniqueIndex("devices_token_hash").on(t.tokenHash).where(sql`revoked_at IS NULL`),
	],
);

/**
 * Ephemeral pairing codes for the device-flow OAuth-style approval.
 * Cron deletes expired rows.
 */
export const deviceCodes = sqliteTable("device_codes", {
	code: text("code").primaryKey(), // 'DV-XXXX-XXXX'
	kind: text("kind").notNull(),
	labelHint: text("label_hint"),
	status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'expired'
	approvedUserId: text("approved_user_id").references(() => user.id, {
		onDelete: "cascade",
	}),
	expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const channels = sqliteTable(
	"channels",
	{
		id: text("id").primaryKey(),
		// ECDSA P-256 raw public key (130-char hex). Every channel
		// authenticates via ECDSA signatures.
		publicKey: text("public_key").notNull(),
		port: integer("port").notNull().default(3000),
		allowedPaths: text("allowed_paths").notNull().default("[]"),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		deviceId: text("device_id").references(() => devices.id, { onDelete: "set null" }),
		label: text("label"),
		// 'async' answers senders 202 at once; 'sync' holds the request until
		// localhost's response arrives and returns it (relay/src/sync.ts).
		responseMode: text("response_mode").notNull().default("async"),
		syncTimeoutMs: integer("sync_timeout_ms").notNull().default(25000),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		// Nullable: owned channels have NULL expiresAt (perpetual; retention
		// enforced on events). Ownerless landing-page demo channels expire.
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
	},
	(t) => [
		index("channels_user").on(t.userId),
		index("channels_device").on(t.deviceId).where(sql`device_id IS NOT NULL`),
		// The hourly cleanup and the live-demo cap scan expiring channels only.
		index("channels_expires")
			.on(t.expiresAt)
			.where(sql`expires_at IS NOT NULL`),
	],
);

export const events = sqliteTable(
	"events",
	{
		id: text("id").primaryKey(),
		channelId: text("channel_id")
			.notNull()
			.references(() => channels.id, { onDelete: "cascade" }),
		method: text("method").notNull(),
		path: text("path").notNull(),
		requestHeaders: text("request_headers").notNull().default("{}"),
		requestBody: text("request_body"),
		responseStatus: integer("response_status"),
		responseHeaders: text("response_headers"),
		responseBody: text("response_body"),
		latencyMs: integer("latency_ms"),
		error: text("error"),
		receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		// Observability — replay linkage and device attribution.
		replayOf: text("replay_of").references((): AnySQLiteColumn => events.id, {
			onDelete: "set null",
		}),
		replayedByUserId: text("replayed_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		deviceId: text("device_id").references(() => devices.id, { onDelete: "set null" }),
		kind: text("kind").notNull().default("live"), // 'live' | 'replay'
		// Free-form text — accepts both `dev_<20>` ids (paired devices) and
		// client-generated ids (web tabs, extension installs). Atomic
		// UPDATE … WHERE claimed_by_device_id IS NULL (or stale) is the
		// contention primitive — see POST /hook/:channelId/claim.
		claimedByDeviceId: text("claimed_by_device_id"),
		claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
	},
	(t) => [
		index("events_channel_received_desc").on(t.channelId, t.receivedAt),
		index("events_replay_of").on(t.replayOf).where(sql`replay_of IS NOT NULL`),
		// A live event never points at another; a replay normally does, but
		// keeps existing (replay_of NULL) when retention deletes its original.
		// The Postgres schema required replay_of on every replay, which made
		// ON DELETE SET NULL fail and the retention sweep abort.
		check("events_live_has_no_replay_of", sql`${t.kind} = 'replay' OR ${t.replayOf} IS NULL`),
	],
);

/**
 * Subscriptions — one row per user (Polar-driven). `user.plan` is denormalized
 * from `subscriptions.status` for fast lookup; webhook handler keeps them in sync.
 */
export const subscriptions = sqliteTable("subscriptions", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	status: text("status").notNull(), // trialing | active | past_due | canceled | incomplete
	provider: text("provider").notNull(),
	customerId: text("customer_id").notNull(),
	subscriptionId: text("subscription_id").notNull(),
	currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }).notNull(),
	cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export type ChannelRow = typeof channels.$inferSelect;
export type NewChannelRow = typeof channels.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type DeviceRow = typeof devices.$inferSelect;
export type NewDeviceRow = typeof devices.$inferInsert;
export type DeviceCodeRow = typeof deviceCodes.$inferSelect;
export type NewDeviceCodeRow = typeof deviceCodes.$inferInsert;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionRow = typeof subscriptions.$inferInsert;
