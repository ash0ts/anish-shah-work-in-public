CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `connector_credentials` (
	`provider` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`key_version` text DEFAULT 'v1' NOT NULL,
	`credential_label` text DEFAULT 'Owner credential' NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connector_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`public_payload_json` text NOT NULL,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`fresh_until` text NOT NULL,
	`etag` text,
	`item_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `connector_snapshots_provider_fetched_idx` ON `connector_snapshots` (`provider`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `editorial_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text DEFAULT '{}' NOT NULL,
	`updated_by_email` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `public_records` (
	`id` text PRIMARY KEY NOT NULL,
	`record_type` text NOT NULL,
	`slug` text,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`public_payload_json` text DEFAULT '{}' NOT NULL,
	`publication_state` text DEFAULT 'review_required' NOT NULL,
	`verification_state` text DEFAULT 'tentative' NOT NULL,
	`evidence_access` text DEFAULT 'public_web' NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`published_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_records_slug_unique` ON `public_records` (`slug`);--> statement-breakpoint
CREATE INDEX `public_records_state_sort_idx` ON `public_records` (`publication_state`,`sort_order`);--> statement-breakpoint
CREATE INDEX `public_records_type_idx` ON `public_records` (`record_type`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`requested_by_email` text,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`finished_at` text,
	`http_status` integer,
	`item_count` integer,
	`error_code` text,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `sync_runs_provider_started_idx` ON `sync_runs` (`provider`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_runs_one_running_per_provider` ON `sync_runs` (`provider`) WHERE "sync_runs"."status" = 'running';