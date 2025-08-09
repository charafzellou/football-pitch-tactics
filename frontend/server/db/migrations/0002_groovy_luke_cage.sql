CREATE TABLE `event_type` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `season` (
	`id` integer PRIMARY KEY NOT NULL,
	`year` text NOT NULL,
	`ended` text DEFAULT 'false' NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_game` (
	`id` integer PRIMARY KEY NOT NULL,
	`player_team_id` integer NOT NULL,
	`season` integer NOT NULL,
	`current_date` integer NOT NULL,
	FOREIGN KEY (`player_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`season`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_game`("id", "player_team_id", "season", "current_date") SELECT "id", "player_team_id", "season", "current_date" FROM `game`;--> statement-breakpoint
DROP TABLE `game`;--> statement-breakpoint
ALTER TABLE `__new_game` RENAME TO `game`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_match_events` (
	`id` integer PRIMARY KEY NOT NULL,
	`match_id` integer NOT NULL,
	`minute` integer NOT NULL,
	`event_type` integer NOT NULL,
	`player_id` integer,
	`team_id` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_type`) REFERENCES `event_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_match_events`("id", "match_id", "minute", "event_type", "player_id", "team_id") SELECT "id", "match_id", "minute", "event_type", "player_id", "team_id" FROM `match_events`;--> statement-breakpoint
DROP TABLE `match_events`;--> statement-breakpoint
ALTER TABLE `__new_match_events` RENAME TO `match_events`;--> statement-breakpoint
CREATE TABLE `__new_matches` (
	`id` integer PRIMARY KEY NOT NULL,
	`home_team_id` integer NOT NULL,
	`away_team_id` integer NOT NULL,
	`home_score` integer,
	`away_score` integer,
	`season` integer NOT NULL,
	`match_date` integer NOT NULL,
	FOREIGN KEY (`home_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`away_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`season`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_matches`("id", "home_team_id", "away_team_id", "home_score", "away_score", "season", "match_date") SELECT "id", "home_team_id", "away_team_id", "home_score", "away_score", "season", "match_date" FROM `matches`;--> statement-breakpoint
DROP TABLE `matches`;--> statement-breakpoint
ALTER TABLE `__new_matches` RENAME TO `matches`;