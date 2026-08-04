-- Add lineup column to teams table
-- Stores the selected starting XI as a JSON array of player ids (e.g. "[12,45,...]").
-- Null means no XI was chosen, and the match engine auto-selects one.
ALTER TABLE `teams` ADD COLUMN `lineup` text;
