CREATE TABLE `club_news` (
	`id` integer PRIMARY KEY NOT NULL,
	`season` integer NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`category` text NOT NULL,
	`tone` text DEFAULT 'neutral' NOT NULL,
	`headline` text NOT NULL,
	`body` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transfer_offers` (
	`id` integer PRIMARY KEY NOT NULL,
	`player_id` integer NOT NULL,
	`from_team_id` integer NOT NULL,
	`to_team_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`season` integer NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `players` ADD `free_agent` integer DEFAULT 0 NOT NULL;