-- Migration 011: manual workout entry needs a score and optional VO2 max, per
-- Abhishek's explicit field list -- neither existed on atlas_workout_logs yet.

ALTER TABLE atlas_workout_logs ADD COLUMN IF NOT EXISTS workout_score INTEGER;
ALTER TABLE atlas_workout_logs ADD COLUMN IF NOT EXISTS vo2_max NUMERIC;
