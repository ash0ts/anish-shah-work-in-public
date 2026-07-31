CREATE TABLE `connector_oauth_transactions` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`key_version` text DEFAULT 'v1' NOT NULL,
	`owner_email` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `connector_oauth_owner_provider_expiry_idx` ON `connector_oauth_transactions` (`owner_email`,`provider`,`expires_at`);
