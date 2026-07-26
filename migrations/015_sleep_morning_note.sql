-- Migration 015: Add morning_note column to sleep logs.
-- Keeps the subjective morning reflection ("how do I feel") distinct from
-- the general note field (which stays as optional context like "took melatonin").

ALTER TABLE atlas_sleep_logs ADD COLUMN IF NOT EXISTS morning_note TEXT;
