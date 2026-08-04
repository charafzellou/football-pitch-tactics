-- Rework match event types to match the calibrated set the engine generates.
--
-- Removes 'miss' (redundant: an off-target attempt is already a 'shot') and
-- adds 'shot_on_target', 'corner', 'cross' and 'offside'.
--
-- Existing 'miss' events are reassigned to 'shot' rather than deleted, so no
-- match history is lost and the foreign key stays satisfied.

UPDATE `match_events`
SET `event_type` = (SELECT `id` FROM `event_type` WHERE `name` = 'shot')
WHERE `event_type` IN (SELECT `id` FROM `event_type` WHERE `name` = 'miss')
  AND EXISTS (SELECT 1 FROM `event_type` WHERE `name` = 'shot');

DELETE FROM `event_type` WHERE `name` = 'miss';

INSERT INTO `event_type` (`name`)
SELECT 'shot_on_target'
WHERE NOT EXISTS (SELECT 1 FROM `event_type` WHERE `name` = 'shot_on_target');

INSERT INTO `event_type` (`name`)
SELECT 'corner'
WHERE NOT EXISTS (SELECT 1 FROM `event_type` WHERE `name` = 'corner');

INSERT INTO `event_type` (`name`)
SELECT 'cross'
WHERE NOT EXISTS (SELECT 1 FROM `event_type` WHERE `name` = 'cross');

INSERT INTO `event_type` (`name`)
SELECT 'offside'
WHERE NOT EXISTS (SELECT 1 FROM `event_type` WHERE `name` = 'offside');
