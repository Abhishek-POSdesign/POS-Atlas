-- Migration 010: atlas_tasks gains a kind (task/reminder) distinction, matching the old
-- app's concept. Needed for the dashboard rebuild's Add Task modal ("whether it's a
-- reminder") and task-row display (bell icon for a reminder vs. a project badge/plain dot
-- for a task) -- Atlas's task model never had this split, project attachment alone doesn't
-- capture the same meaning (a reminder can still belong to a project).

ALTER TABLE atlas_tasks ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'reminder'));
