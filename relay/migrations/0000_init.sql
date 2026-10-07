CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`port` integer DEFAULT 3000 NOT NULL,
	`allowed_paths` text DEFAULT '[]' NOT NULL,
	`user_id` text,
	`device_id` text,
	`label` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `channels_user` ON `channels` (`user_id`);--> statement-breakpoint
CREATE INDEX `channels_device` ON `channels` (`device_id`) WHERE device_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `device_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label_hint` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`approved_user_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`approved_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`os` text,
	`user_agent` text,
	`last_seen_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `devices_user_active` ON `devices` (`user_id`) WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash` ON `devices` (`token_hash`) WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`request_headers` text DEFAULT '{}' NOT NULL,
	`request_body` text,
	`response_status` integer,
	`response_headers` text,
	`response_body` text,
	`latency_ms` integer,
	`error` text,
	`received_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`replay_of` text,
	`replayed_by_user_id` text,
	`device_id` text,
	`kind` text DEFAULT 'live' NOT NULL,
	`claimed_by_device_id` text,
	`claimed_at` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`replay_of`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`replayed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "events_live_has_no_replay_of" CHECK("events"."kind" = 'replay' OR "events"."replay_of" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `events_channel_received_desc` ON `events` (`channel_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `events_replay_of` ON `events` (`replay_of`) WHERE replay_of IS NOT NULL;--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`customer_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`current_period_end` integer NOT NULL,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`trial_ends_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)),
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer))
);
