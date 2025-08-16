CREATE TABLE `positions` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `positions_name_unique` ON `positions` (`name`);