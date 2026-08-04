CREATE TABLE `simulation_sessions` (
	`session_hash` text PRIMARY KEY NOT NULL,
	`campaign_version` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`scene_id` text DEFAULT 'act-1' NOT NULL,
	`safe_state_json` text NOT NULL,
	`free_text_turns` integer DEFAULT 0 NOT NULL,
	`generation_calls` integer DEFAULT 0 NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`pending_request_id` text,
	`generation_lease_until` text,
	`last_request_id` text,
	`last_response_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `simulation_sessions_expiry_idx` ON `simulation_sessions` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `simulation_sessions_status_updated_idx` ON `simulation_sessions` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `simulation_daily_budget` (
	`budget_date` text PRIMARY KEY NOT NULL,
	`model_calls` integer DEFAULT 0 NOT NULL,
	`authored_fallbacks` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `simulation_provider_approvals` (
	`provider` text PRIMARY KEY NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`reference` text NOT NULL,
	`approved_at` text NOT NULL,
	`expires_at` text,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `simulation_provider_approvals_enabled_expiry_idx` ON `simulation_provider_approvals` (`enabled`,`expires_at`);
