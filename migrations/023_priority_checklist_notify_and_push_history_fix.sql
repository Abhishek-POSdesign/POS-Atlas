-- Migration 023: checklist per-item notifications + push history fixed to
-- dedupe per-day instead of forever.
--
-- Confirmed real bug (2026-08-06 session): send-reminders selected tasks
-- via `select=*,atlas_push_history(id)` and filtered out any task that had
-- ANY row in atlas_push_history, ever. Once a task was notified once, it
-- could never be notified again -- including after being snoozed, since
-- snooze only ever changed scheduled_time and never touched push history.
-- Fixed by giving atlas_push_history a sent_date column and deduping on
-- (task_id, sent_date) instead of "any row exists". Existing rows are
-- backfilled from their real sent_at date, not defaulted to today, so
-- historic dedup state isn't silently rewritten.
ALTER TABLE atlas_push_history ADD COLUMN IF NOT EXISTS sent_date DATE;
UPDATE atlas_push_history SET sent_date = sent_at::date WHERE sent_date IS NULL;
ALTER TABLE atlas_push_history ALTER COLUMN sent_date SET NOT NULL;
ALTER TABLE atlas_push_history ALTER COLUMN sent_date SET DEFAULT CURRENT_DATE;
CREATE UNIQUE INDEX IF NOT EXISTS atlas_push_history_task_date_uq ON atlas_push_history(task_id, sent_date);

-- Checklist per-item notifications, explicit opt-in per item (2026-08-06
-- session, Abhishek's own framing: "build a habit to a new checklist item
-- once it becomes a habit, I can turn off the notification"). Off by
-- default for every existing and new item.
ALTER TABLE atlas_checklist_items ADD COLUMN IF NOT EXISTS notify_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE atlas_checklist_items ADD COLUMN IF NOT EXISTS notify_time TIME;

-- Same per-day dedup shape as atlas_push_history above, kept as its own
-- table (not a shared polymorphic one) since checklist items and tasks
-- have separate lifecycles/RLS needs and the two selectors in
-- send-reminders already read from separate tables.
CREATE TABLE IF NOT EXISTS atlas_checklist_push_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES atlas_checklist_items(id) ON DELETE CASCADE,
    sent_date DATE NOT NULL DEFAULT CURRENT_DATE,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(item_id, sent_date)
);
ALTER TABLE atlas_checklist_push_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON atlas_checklist_push_history
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
