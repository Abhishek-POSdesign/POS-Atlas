-- Migration 006: checklist history gains a user-editable logged_time and
-- note, matching the old app's "Log" popup (time + optional note per mark).
-- These are ordinary user-entered fields, not system audit timestamps, so
-- they go through the normal verified upsert/update path in db.js -- no
-- RPC needed (unlike deleted_at/archived_at transitions).

ALTER TABLE atlas_checklist_history ADD COLUMN IF NOT EXISTS logged_time TIME;
ALTER TABLE atlas_checklist_history ADD COLUMN IF NOT EXISTS note TEXT;
