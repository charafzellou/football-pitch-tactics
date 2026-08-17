CREATE TABLE `finance_ledger` (
	`id` integer PRIMARY KEY NOT NULL,
	`team_id` integer NOT NULL,
	`season` integer NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`description` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `game` ADD `sacking_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `game` ADD `board_confidence` integer DEFAULT 65 NOT NULL;--> statement-breakpoint
ALTER TABLE `game` ADD `fan_confidence` integer DEFAULT 65 NOT NULL;--> statement-breakpoint
ALTER TABLE `game` ADD `board_expectation` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `game` ADD `confidence_streak` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `game` ADD `dismissed_at_season` integer;--> statement-breakpoint
ALTER TABLE `players` ADD `wage` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `contract_until_season` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `reputation` integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `stadium_name` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `stadium_capacity` integer DEFAULT 20000 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `ticket_price` integer DEFAULT 30 NOT NULL;