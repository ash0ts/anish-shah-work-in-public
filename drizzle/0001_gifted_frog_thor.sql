CREATE TABLE `publication_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL,
	`record_count` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`published_by_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `publication_snapshots_created_idx` ON `publication_snapshots` (`created_at`);--> statement-breakpoint
CREATE INDEX `publication_snapshots_hash_idx` ON `publication_snapshots` (`content_hash`);--> statement-breakpoint
ALTER TABLE `public_records` ADD `approved_public_wording` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `public_records` ADD `public_caveat` text DEFAULT '' NOT NULL;