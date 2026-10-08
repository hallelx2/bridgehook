ALTER TABLE `channels` ADD `response_mode` text DEFAULT 'async' NOT NULL;--> statement-breakpoint
ALTER TABLE `channels` ADD `sync_timeout_ms` integer DEFAULT 25000 NOT NULL;