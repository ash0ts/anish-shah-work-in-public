CREATE TABLE `maintenance_state` (
	`key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`checked_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
