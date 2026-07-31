CREATE TABLE `play_promotion_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`owner_email` text NOT NULL,
	`target_origin` text NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`ciphertext` text,
	`iv` text,
	`key_version` text,
	`providers_json` text DEFAULT '[]' NOT NULL,
	`expires_at` text NOT NULL,
	`staged_expires_at` text,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `play_promotion_transactions_token_hash_unique` ON `play_promotion_transactions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `play_promotion_owner_status_idx` ON `play_promotion_transactions` (`owner_email`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `play_promotion_expiry_idx` ON `play_promotion_transactions` (`expires_at`);