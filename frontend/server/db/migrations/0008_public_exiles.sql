CREATE TABLE `season_summary` (
	`id` integer PRIMARY KEY NOT NULL,
	`season` integer NOT NULL,
	`league_id` integer NOT NULL,
	`champion_team_id` integer NOT NULL,
	`champion_points` integer NOT NULL,
	`player_team_id` integer,
	`player_position` integer,
	`player_points` integer,
	`completed_at` integer NOT NULL,
	FOREIGN KEY (`season`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`champion_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `matches` ADD `round` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `potential` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `retired` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill `potential` for players that predate the column.
--
-- The default of 0 is survivable (`developSkill` takes max(skill, potential),
-- so a 0 ceiling just means no growth) but it would silently freeze every
-- existing player. This gives age-appropriate headroom instead, matching the
-- bands in `initialPotential()`.
UPDATE `players` SET `potential` = MIN(99, `skill_level` + CASE
  WHEN `age` <= 18 THEN 18
  WHEN `age` <= 21 THEN 13
  WHEN `age` <= 24 THEN 8
  WHEN `age` <= 27 THEN 3
  ELSE 1
END) WHERE `potential` = 0;