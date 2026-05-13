/**
 * Better-Auth standard schema (PostgreSQL / Drizzle).
 *
 * Table names are SINGULAR (`user`, `session`, `account`, `verification`) to
 * match Better-Auth's defaults — overriding them via Better-Auth config is
 * possible but adds friction with no upside.
 *
 * BridgeHook adds two custom columns to `user`:
 *   - `plan` — billing tier (free / hobby / pro / team / trialing / selfhost)
 *   - `trialEndsAt` — legacy 7-day trial deadline; null on new free signups
 *
 * Re-run via `npx @better-auth/cli generate` if the Better-Auth version
 * changes; merge any added columns by hand.
 */
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	// BridgeHook custom — billing/quota state.
	// Default flipped to "free" at launch (was "trialing" before the
	// free-tier pivot). Better-Auth's drizzle adapter strips unknown fields
	// from its INSERT, so this column default is what actually lands on new
	// signups — the `databaseHooks` override in relay/src/auth.ts is
	// informational, not load-bearing.
	plan: text("plan").notNull().default("free"),
	trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
});

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	token: text("token").notNull().unique(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
	scope: text("scope"),
	idToken: text("id_token"),
	password: text("password"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type UserRow = typeof user.$inferSelect;
export type NewUserRow = typeof user.$inferInsert;
export type SessionRow = typeof session.$inferSelect;
export type AccountRow = typeof account.$inferSelect;
export type VerificationRow = typeof verification.$inferSelect;
