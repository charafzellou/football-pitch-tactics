CREATE TABLE `loans` (
	`id` integer PRIMARY KEY NOT NULL,
	`team_id` integer NOT NULL,
	`principal` integer NOT NULL,
	`outstanding` integer NOT NULL,
	`rate_per_season` real NOT NULL,
	`taken_season` integer NOT NULL,
	`term_seasons` integer NOT NULL,
	`until_season` integer NOT NULL,
	`repayment_per_round` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
