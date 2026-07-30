-- Migration 017: soft-deleting a project no longer leaves its tasks silently
-- pointing at a project that no longer exists anywhere active.
--
-- Confirmed live bug (2026-07-31 correction pass): atlas_projects_soft_delete
-- only ever touched the project row itself. A task's project_id was never
-- reassigned, so a deleted project's tasks kept referencing it forever --
-- Today (which only knows about active projects) would show the task as
-- "Standalone" with no way to re-link it (the project isn't offered as an
-- option anymore, since it's gone), while the task's own project_id field
-- still silently pointed at the dead row. Decided fix, per Abhishek: convert
-- those tasks to genuinely standalone (project_id = NULL) automatically,
-- atomically, in the same transaction as the delete -- not a separate client
-- call, so there's no window where the project is deleted but its tasks
-- haven't been reassigned yet.
--
-- Only non-deleted tasks are touched (a task already in the trash doesn't
-- need reassigning -- it shows nowhere either way, and the Restore view
-- reads task rows directly, not through a project). Restoring a deleted
-- project later does NOT re-link these tasks back -- once converted to
-- standalone, that's a deliberate, permanent state change, not a suspended
-- one; silently re-linking them on restore would be a surprising side effect
-- nobody asked for.

CREATE OR REPLACE FUNCTION atlas_projects_soft_delete(p_id UUID)
RETURNS SETOF atlas_projects LANGUAGE plpgsql AS $$
BEGIN
    UPDATE atlas_tasks SET project_id = NULL
    WHERE project_id = p_id AND deleted_at IS NULL;

    RETURN QUERY
    UPDATE atlas_projects SET deleted_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING *;
END;
$$;
