CREATE TABLE `sponsorship_deals` (
	`id` integer PRIMARY KEY NOT NULL,
	`team_id` integer NOT NULL,
	`slot` text NOT NULL,
	`sponsor_name` text NOT NULL,
	`base_fee` integer NOT NULL,
	`seasons` integer DEFAULT 3 NOT NULL,
	`signed_season` integer NOT NULL,
	`until_season` integer NOT NULL,
	`bonus_champion` integer DEFAULT 0 NOT NULL,
	`bonus_top_four` integer DEFAULT 0 NOT NULL,
	`bonus_survival` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'offered' NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
