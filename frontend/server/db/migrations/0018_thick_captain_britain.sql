PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_game` (
	`id` integer PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`player_team_id` integer NOT NULL,
	`season` integer NOT NULL,
	`current_date` integer NOT NULL,
	`sacking_enabled` integer DEFAULT 0 NOT NULL,
	`board_confidence` integer DEFAULT 65 NOT NULL,
	`fan_confidence` integer DEFAULT 65 NOT NULL,
	`board_expectation` integer DEFAULT 10 NOT NULL,
	`confidence_streak` integer DEFAULT 0 NOT NULL,
	`dismissed_at_season` integer,
	`insolvency_stage` integer DEFAULT 0 NOT NULL,
	`insolvent_rounds` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`player_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_game`("id", "token", "player_team_id", "season", "current_date", "sacking_enabled", "board_confidence", "fan_confidence", "board_expectation", "confidence_streak", "dismissed_at_season", "insolvency_stage", "insolvent_rounds") SELECT "id", "token", "player_team_id", "season", "current_date", "sacking_enabled", "board_confidence", "fan_confidence", "board_expectation", "confidence_streak", "dismissed_at_season", "insolvency_stage", "insolvent_rounds" FROM `game`;--> statement-breakpoint
DROP TABLE `game`;--> statement-breakpoint
ALTER TABLE `__new_game` RENAME TO `game`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `game_token_unique` ON `game` (`token`);--> statement-breakpoint
CREATE TABLE `__new_matches` (
	`id` integer PRIMARY KEY NOT NULL,
	`game_id` integer NOT NULL,
	`home_team_id` integer NOT NULL,
	`away_team_id` integer NOT NULL,
	`home_score` integer,
	`away_score` integer,
	`played` integer DEFAULT 0 NOT NULL,
	`season` integer NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`match_date` integer NOT NULL,
	`state` text,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`home_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`away_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_matches`("id", "game_id", "home_team_id", "away_team_id", "home_score", "away_score", "played", "season", "round", "match_date", "state") SELECT "id", "game_id", "home_team_id", "away_team_id", "home_score", "away_score", "played", "season", "round", "match_date", "state" FROM `matches`;--> statement-breakpoint
DROP TABLE `matches`;--> statement-breakpoint
ALTER TABLE `__new_matches` RENAME TO `matches`;--> statement-breakpoint
CREATE TABLE `__new_season_summary` (
	`id` integer PRIMARY KEY NOT NULL,
	`game_id` integer NOT NULL,
	`season` integer NOT NULL,
	`league_id` integer NOT NULL,
	`champion_team_id` integer NOT NULL,
	`champion_points` integer NOT NULL,
	`player_team_id` integer,
	`player_position` integer,
	`player_points` integer,
	`completed_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`champion_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_season_summary`("id", "game_id", "season", "league_id", "champion_team_id", "champion_points", "player_team_id", "player_position", "player_points", "completed_at") SELECT "id", "game_id", "season", "league_id", "champion_team_id", "champion_points", "player_team_id", "player_position", "player_points", "completed_at" FROM `season_summary`;--> statement-breakpoint
DROP TABLE `season_summary`;--> statement-breakpoint
ALTER TABLE `__new_season_summary` RENAME TO `season_summary`;--> statement-breakpoint
ALTER TABLE `club_news` ADD `game_id` integer NOT NULL REFERENCES game(id);--> statement-breakpoint
ALTER TABLE `players` ADD `game_id` integer REFERENCES game(id);--> statement-breakpoint
ALTER TABLE `season` ADD `game_id` integer NOT NULL REFERENCES game(id);--> statement-breakpoint
ALTER TABLE `season` ADD `season_number` integer NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `season_game_number_unique` ON `season` (`game_id`,`season_number`);--> statement-breakpoint
ALTER TABLE `teams` ADD `game_id` integer REFERENCES game(id);