CREATE TABLE `travel_media_deletions` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_keys_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "travel_media_deletions_status_check" CHECK("travel_media_deletions"."status" IN ('pending', 'complete'))
);
--> statement-breakpoint
CREATE INDEX `travel_media_deletions_status_idx` ON `travel_media_deletions` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `travel_photo_tags` (
	`photo_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`photo_id`, `tag`),
	FOREIGN KEY (`photo_id`) REFERENCES `travel_photos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `travel_photo_tags_tag_idx` ON `travel_photo_tags` (`tag`);--> statement-breakpoint
CREATE TABLE `travel_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`place_id` text,
	`storage_key` text NOT NULL,
	`alt_text` text NOT NULL,
	`caption` text,
	`captured_at` text,
	`capture_precision` text,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_cover` integer DEFAULT false NOT NULL,
	`revision` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `travel_trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`place_id`) REFERENCES `travel_places`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "travel_photos_capture_precision_check" CHECK("travel_photos"."capture_precision" IS NULL OR "travel_photos"."capture_precision" IN ('year', 'month', 'day'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `travel_photos_storage_key_unique` ON `travel_photos` (`storage_key`);--> statement-breakpoint
CREATE INDEX `travel_photos_trip_sort_idx` ON `travel_photos` (`trip_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `travel_photos_place_idx` ON `travel_photos` (`place_id`);--> statement-breakpoint
CREATE TABLE `travel_places` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`label` text NOT NULL,
	`country_code` text NOT NULL,
	`country_name` text NOT NULL,
	`admin1_code` text,
	`admin1_name` text,
	`precision` text NOT NULL,
	`public_lat` real NOT NULL,
	`public_lng` real NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`revision` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `travel_trips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "travel_places_precision_check" CHECK("travel_places"."precision" IN ('country', 'region', 'city_approximate'))
);
--> statement-breakpoint
CREATE INDEX `travel_places_trip_sort_idx` ON `travel_places` (`trip_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `travel_places_country_admin_idx` ON `travel_places` (`country_code`,`admin1_code`);--> statement-breakpoint
CREATE TABLE `travel_publication_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`trip_count` integer DEFAULT 0 NOT NULL,
	`photo_count` integer DEFAULT 0 NOT NULL,
	`published_by_email` text NOT NULL,
	`published_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `travel_publication_hash_unique` ON `travel_publication_snapshots` (`content_hash`);--> statement-breakpoint
CREATE INDEX `travel_publication_published_idx` ON `travel_publication_snapshots` (`published_at`);--> statement-breakpoint
CREATE TABLE `travel_publication_state` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `travel_publication_snapshots`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `travel_trips` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`status` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text,
	`period_precision` text NOT NULL,
	`published_at` text,
	`revision` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "travel_trips_status_check" CHECK("travel_trips"."status" IN ('planned', 'current', 'completed')),
	CONSTRAINT "travel_trips_period_precision_check" CHECK("travel_trips"."period_precision" IN ('year', 'month', 'day'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `travel_trips_slug_unique` ON `travel_trips` (`slug`);--> statement-breakpoint
CREATE INDEX `travel_trips_published_period_idx` ON `travel_trips` (`published_at`,`period_start`);--> statement-breakpoint
CREATE TABLE `travel_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`media_type` text NOT NULL,
	`declared_bytes` integer NOT NULL,
	`stored_bytes` integer,
	`processed_width` integer,
	`processed_height` integer,
	`storage_key` text,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `travel_trips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "travel_uploads_status_check" CHECK("travel_uploads"."status" IN ('issued', 'uploaded', 'consumed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `travel_uploads_trip_status_idx` ON `travel_uploads` (`trip_id`,`status`);--> statement-breakpoint
CREATE INDEX `travel_uploads_expiry_idx` ON `travel_uploads` (`expires_at`);--> statement-breakpoint
INSERT INTO `maintenance_state` (`key`, `status`, `details_json`, `checked_at`, `updated_at`)
VALUES (
	'travel.cleanup',
	'ready',
	'{"removedUploads":0,"removedSnapshots":0,"removedMedia":0}',
	CURRENT_TIMESTAMP,
	CURRENT_TIMESTAMP
)
ON CONFLICT(`key`) DO NOTHING;
