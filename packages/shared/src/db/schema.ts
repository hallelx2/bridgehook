import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

export * from "./auth-schema.js";

/**
 * BridgeHook devices — extension/desktop/CLI instances paired to an account.
 * Token issued once at pairing; only its SHA-256 hash is stored.
 */
export const devices = pgTable(
	"devices",
	{
		id: varchar("id", { length: 24 }).primaryKey(), // 'dev_' + 20-char random
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		kind: varchar("kind", { length: 16 }).notNull(), // 'extension' | 'desktop' | 'cli' | 'web'
		label: text("label").notNull(),
		tokenHash: text("token_hash").notNull(),
		os: text("os"),
		userAgent: text("user_agent"),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		userActive: index("devices_user_active").on(t.userId).where(sql`revoked_at IS NULL`),
		tokenHashUnique: uniqueIndex("devices_token_hash")
			.on(t.tokenHash)
			.where(sql`revoked_at IS NULL`),
	}),
);

/**
 * Ephemeral pairing codes for the device-flow OAuth-style approval.
 * Cron deletes expired rows.
 */
export const deviceCodes = pgTable("device_codes", {
	code: varchar("code", { length: 16 }).primaryKey(), // 'DV-XXXX-XXXX'
	kind: varchar("kind", { length: 16 }).notNull(),
	labelHint: text("label_hint"),
	status: varchar("status", { length: 16 }).notNull().default("pending"), // 'pending' | 'approved' | 'expired'
	approvedUserId: text("approved_user_id").references(() => user.id, {
		onDelete: "cascade",
	}),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const channels = pgTable(
	"channels",
	{
		id: varchar("id", { length: 24 }).primaryKey(),
		// Exactly one of `publicKey` or `secretHash` populated per row (legacy bearer
		// scheme to be dropped once anonymous channels drain — see commit 17).
		publicKey: text("public_key"),
		secretHash: text("secret_hash"),
		port: integer("port").notNull().default(3000),
		allowedPaths: text("allowed_paths").notNull().default("[]"),
		// Ownership — nullable while existing anonymous channels drain (24h post-deploy).
		// commit 17 makes user_id NOT NULL.
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		deviceId: varchar("device_id", { length: 24 }).references(() => devices.id, {
			onDelete: "set null",
		}),
		label: text("label"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		// Nullable: owned channels have NULL expiresAt (perpetual; retention enforced on events).
		// Anonymous channels carry a 24h expiry.
		expiresAt: timestamp("expires_at", { withTimezone: true }),
	},
	(t) => ({
		userIdx: index("channels_user").on(t.userId),
		deviceIdx: index("channels_device").on(t.deviceId).where(sql`device_id IS NOT NULL`),
	}),
);

export const events = pgTable(
	"events",
	{
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
		// Observability — replay linkage and device attribution.
		// replay_of FK declared in the SQL migration (self-reference; Drizzle ORM
		// has awkward syntax for self-FKs and we don't gain much from typing it).
		replayOf: varchar("replay_of", { length: 32 }),
		replayedByUserId: text("replayed_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		deviceId: varchar("device_id", { length: 24 }).references(() => devices.id, {
			onDelete: "set null",
		}),
		kind: varchar("kind", { length: 16 }).notNull().default("live"), // 'live' | 'replay'
		claimedByDeviceId: varchar("claimed_by_device_id", { length: 24 }).references(
			() => devices.id,
			{ onDelete: "set null" },
		),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
	},
	(t) => ({
		channelReceivedDesc: index("events_channel_received_desc").on(t.channelId, t.receivedAt),
		replayOfIdx: index("events_replay_of").on(t.replayOf).where(sql`replay_of IS NOT NULL`),
		replayKindConsistent: check(
			"events_replay_kind_consistent",
			sql`(${t.kind} = 'replay') = (${t.replayOf} IS NOT NULL)`,
		),
	}),
);

/**
 * Subscriptions — one row per user (Stripe-driven). `users.plan` is denormalized
 * from `subscriptions.status` for fast lookup; webhook handler keeps them in sync.
 */
export const subscriptions = pgTable("subscriptions", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	status: varchar("status", { length: 24 }).notNull(), // trialing | active | past_due | canceled | incomplete
	provider: varchar("provider", { length: 16 }).notNull(), // 'stripe' | 'paystack'
	customerId: text("customer_id").notNull(),
	subscriptionId: text("subscription_id").notNull(),
	currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
	cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
