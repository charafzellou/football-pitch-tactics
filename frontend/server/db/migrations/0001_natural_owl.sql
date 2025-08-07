CREATE TABLE `game` (
	`id` integer PRIMARY KEY NOT NULL,
	`player_team_id` integer NOT NULL,
	`season` text NOT NULL,
	`current_date` integer NOT NULL,
	FOREIGN KEY (`player_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
