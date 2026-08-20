CREATE TABLE `stadium_events` (
	`id` integer PRIMARY KEY NOT NULL,
	`team_id` integer NOT NULL,
	`season` integer NOT NULL,
	`round` integer NOT NULL,
	`kind` text NOT NULL,
	`promoter_name` text NOT NULL,
	`fee` integer NOT NULL,
	`pitch_wear` integer DEFAULT 0 NOT NULL,
	`fan_reaction` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'offered' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
