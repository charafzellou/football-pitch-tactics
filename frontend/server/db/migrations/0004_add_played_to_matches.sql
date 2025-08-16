-- Add played column to matches table
ALTER TABLE `matches` ADD COLUMN `played` integer NOT NULL DEFAULT 0;

-- Ensure existing rows have played = 0
UPDATE `matches` SET `played` = 0 WHERE `played` IS NULL;
