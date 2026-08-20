ALTER TABLE `game` ADD `insolvency_stage` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `game` ADD `insolvent_rounds` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `stadium_base_name` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `perimeter_level` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `hospitality_boxes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `academy_level` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `training_level` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `season_ticket_share` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `season_ticket_discount` integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `pitch_condition` integer DEFAULT 100 NOT NULL;