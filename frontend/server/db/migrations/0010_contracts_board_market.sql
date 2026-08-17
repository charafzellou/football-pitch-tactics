-- Club economy, phases 3–6: free agents, incoming bids, and the news feed.
--
-- `players.free_agent` mirrors `retired`: the row keeps its `team_id` (which
-- then reads as the club that released them) and squad queries exclude the
-- flag. Making `team_id` nullable was the alternative and would have rippled
-- through every query and type in the server for no gain.

ALTER TABLE `players` ADD `free_agent` integer DEFAULT 0 NOT NULL;
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
