-- Migration 004: two small additive changes from the first real testing round
-- (2026-07-25).
--
-- 1. atlas_tasks.running_note -- an optional "what am I doing right now" note
--    captured when a task is started, shown on the Running Now card. Purely
--    additive, nullable, no existing data affected.
--
-- 2. atlas_project_notes.project_id becomes nullable -- notes are moving from
--    "inside each project workspace" to "one area on the Projects page
--    itself" (Abhishek's testing feedback: the per-project workspace already
--    has current focus/next step/tasks/future plans/work log, a per-project
--    notes section was redundant). Reusing the existing table + RLS policy
--    rather than creating a new one -- a note with project_id IS NULL is a
--    page-level note, a note with project_id set is still available for a
--    future per-project use if ever wanted, but the UI no longer writes those.

ALTER TABLE atlas_tasks ADD COLUMN running_note TEXT;

ALTER TABLE atlas_project_notes ALTER COLUMN project_id DROP NOT NULL;

-- atlas_tasks_complete() already accepts a note; add a matching function for
-- starting a task with an optional note, sharing the same server-clock
-- discipline as the rest of migration 003.
CREATE OR REPLACE FUNCTION atlas_tasks_start(p_id UUID, p_note TEXT DEFAULT NULL)
RETURNS SETOF atlas_tasks LANGUAGE sql AS $$
    UPDATE atlas_tasks SET status = 'in_progress', running_note = p_note
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING *;
$$;
