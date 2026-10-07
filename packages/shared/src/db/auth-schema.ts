/**
 * Better-Auth standard schema (Cloudflare D1 / SQLite, Drizzle).
 *
 * Table names are SINGULAR (`user`, `session`, `account`, `verification`) to
 * match Better-Auth's defaults — overriding them via Better-Auth config is
 * possible but adds friction with no upside.
 *
 * Timestamps are integer milliseconds (`timestamp_ms`), read back as `Date`.
 * Booleans are integers (`mode: "boolean"`).
 *
 * BridgeHook adds two custom columns to `user`:
 *   - `plan` — billing tier (free / hobby / pro / team / trialing / selfhost)
 *   - `trialEndsAt` — legacy 7-day trial deadline; null on new free signups
 *
 * Re-run via `npx @better-auth/cli generate` if the Better-Auth version
 * changes; merge any added columns by hand.
 */
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Current time in integer milliseconds, as a SQLite column default. */
export const nowMs = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
	image: text("image"),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	// BridgeHook custom — billing/quota state.
	// Better-Auth's drizzle adapter strips unknown fields from its INSERT, so
	// this column default is what actually lands on new signups — the
	// `databaseHooks` override in relay/src/auth.ts is informational, not
	// load-bearing.
	plan: text("plan").notNull().default("free"),
	trialEndsAt: integer("trial_ends_at", { mode: "timestamp_ms" }),
});

export const session = sqliteTable("session", {
	id: text("id").primaryKey(),
	token: text("token").notNull().unique(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const account = sqliteTable("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
	refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
	scope: text("scope"),
	idToken: text("id_token"),
	password: text("password"),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const verification = sqliteTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs),
});

export type UserRow = typeof user.$inferSelect;
export type NewUserRow = typeof user.$inferInsert;
export type SessionRow = typeof session.$inferSelect;
export type AccountRow = typeof account.$inferSelect;
export type VerificationRow = typeof verification.$inferSelect;
