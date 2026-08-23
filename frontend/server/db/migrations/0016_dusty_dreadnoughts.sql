ALTER TABLE `club_news` ADD `game_id` integer NOT NULL REFERENCES game(id);--> statement-breakpoint
ALTER TABLE `game` ADD `token` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `game_token_unique` ON `game` (`token`);--> statement-breakpoint
ALTER TABLE `matches` ADD `game_id` integer NOT NULL REFERENCES game(id);--> statement-breakpoint
ALTER TABLE `players` ADD `game_id` integer REFERENCES game(id);--> statement-breakpoint
ALTER TABLE `season` ADD `game_id` integer NOT NULL REFERENCES game(id);--> statement-breakpoint
ALTER TABLE `season` ADD `season_number` integer NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `season_game_number_unique` ON `season` (`game_id`,`season_number`);--> statement-breakpoint
ALTER TABLE `season_summary` ADD `game_id` integer NOT NULL REFERENCES game(id);--> statement-breakpoint
ALTER TABLE `teams` ADD `game_id` integer REFERENCES game(id);