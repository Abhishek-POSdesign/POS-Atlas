-- Migration 023: Add reminder_time to atlas_family_tasks
ALTER TABLE atlas_family_tasks ADD COLUMN IF NOT EXISTS reminder_time TIME;
