-- Migration 003: server-side timestamp handling for updated_at, plus
-- transition functions (soft-delete / restore-from-trash / archive /
-- restore-from-archive) for the Phase 1 entities.
--
-- Why this exists: CLAUDE.md rule #5 says "no client-invented timestamps."
-- A plain PostgREST UPDATE can't express now() in a JSON payload, so:
--   - updated_at is bumped automatically by a BEFORE UPDATE trigger, on
--     every table, forever -- the client never sends this field.
--   - deleted_at / archived_at transitions go through a small function per
--     table that runs "SET deleted_at = now() ... RETURNING *" -- the
--     verified-write pattern (rows returned = success) still applies,
--     it's just called via .rpc() instead of .update().
-- Regular field edits (name, description, status, etc.) still use a plain
-- verified .update() from db.js -- they never touch these two columns.

CREATE OR REPLACE FUNCTION atlas_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON atlas_projects
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON atlas_tasks
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON atlas_task_logs
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON atlas_project_notes
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON atlas_notebook_entries
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON atlas_checklist_items
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON atlas_checklist_history
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON atlas_targets
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON atlas_target_logs
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();

-- ---------- atlas_projects ----------

CREATE OR REPLACE FUNCTION atlas_projects_soft_delete(p_id UUID)
RETURNS SETOF atlas_projects LANGUAGE sql AS $$
    UPDATE atlas_projects SET deleted_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_projects_restore_trash(p_id UUID)
RETURNS SETOF atlas_projects LANGUAGE sql AS $$
    UPDATE atlas_projects SET deleted_at = NULL
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_projects_archive(p_id UUID)
RETURNS SETOF atlas_projects LANGUAGE sql AS $$
    UPDATE atlas_projects SET archived_at = now()
    WHERE id = p_id AND archived_at IS NULL AND deleted_at IS NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_projects_restore_archive(p_id UUID)
RETURNS SETOF atlas_projects LANGUAGE sql AS $$
    UPDATE atlas_projects SET archived_at = NULL
    WHERE id = p_id AND archived_at IS NOT NULL
    RETURNING *;
$$;

-- ---------- atlas_tasks ----------

CREATE OR REPLACE FUNCTION atlas_tasks_soft_delete(p_id UUID)
RETURNS SETOF atlas_tasks LANGUAGE sql AS $$
    UPDATE atlas_tasks SET deleted_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_tasks_restore_trash(p_id UUID)
RETURNS SETOF atlas_tasks LANGUAGE sql AS $$
    UPDATE atlas_tasks SET deleted_at = NULL
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_tasks_archive(p_id UUID)
RETURNS SETOF atlas_tasks LANGUAGE sql AS $$
    UPDATE atlas_tasks SET archived_at = now()
    WHERE id = p_id AND archived_at IS NULL AND deleted_at IS NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_tasks_restore_archive(p_id UUID)
RETURNS SETOF atlas_tasks LANGUAGE sql AS $$
    UPDATE atlas_tasks SET archived_at = NULL
    WHERE id = p_id AND archived_at IS NOT NULL
    RETURNING *;
$$;

-- Verified task completion -- sets status + completed_at together, server clock.
CREATE OR REPLACE FUNCTION atlas_tasks_complete(p_id UUID, p_note TEXT DEFAULT NULL)
RETURNS SETOF atlas_tasks LANGUAGE sql AS $$
    UPDATE atlas_tasks SET status = 'done', completed_at = now(), completion_note = p_note
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING *;
$$;

-- ---------- atlas_project_notes ----------

CREATE OR REPLACE FUNCTION atlas_project_notes_soft_delete(p_id UUID)
RETURNS SETOF atlas_project_notes LANGUAGE sql AS $$
    UPDATE atlas_project_notes SET deleted_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_project_notes_restore_trash(p_id UUID)
RETURNS SETOF atlas_project_notes LANGUAGE sql AS $$
    UPDATE atlas_project_notes SET deleted_at = NULL
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING *;
$$;

-- ---------- atlas_notebook_entries ----------

CREATE OR REPLACE FUNCTION atlas_notebook_entries_soft_delete(p_id UUID)
RETURNS SETOF atlas_notebook_entries LANGUAGE sql AS $$
    UPDATE atlas_notebook_entries SET deleted_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_notebook_entries_restore_trash(p_id UUID)
RETURNS SETOF atlas_notebook_entries LANGUAGE sql AS $$
    UPDATE atlas_notebook_entries SET deleted_at = NULL
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING *;
$$;

-- ---------- atlas_task_logs ----------

CREATE OR REPLACE FUNCTION atlas_task_logs_soft_delete(p_id UUID)
RETURNS SETOF atlas_task_logs LANGUAGE sql AS $$
    UPDATE atlas_task_logs SET deleted_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_task_logs_restore_trash(p_id UUID)
RETURNS SETOF atlas_task_logs LANGUAGE sql AS $$
    UPDATE atlas_task_logs SET deleted_at = NULL
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING *;
$$;
