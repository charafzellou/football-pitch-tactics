-- Support pausable matches: half-time, substitutions, and mid-match tactics.
--
-- `matches.state` holds the live MatchState JSON (shared/match-state.ts)
-- while a match is paused. Null when the match hasn't started or has
-- already finished — the same convention `teams.lineup` uses for "no value
-- saved yet".
--
-- `match_events.related_player_id` carries the player going off for a
-- `substitution` event; `player_id` is the one coming on.
ALTER TABLE `match_events` ADD `related_player_id` integer REFERENCES players(id);--> statement-breakpoint
ALTER TABLE `matches` ADD `state` text;--> statement-breakpoint

-- `substitution` is added to `event_type` explicitly (rather than relying
-- on the simulate route's lazy upsert) so its id is stable across a fresh
-- `db:seed` and an existing database alike.
INSERT INTO `event_type` (`name`)
SELECT 'substitution'
WHERE NOT EXISTS (SELECT 1 FROM `event_type` WHERE `name` = 'substitution');
