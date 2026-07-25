# Atlas Schema

Supabase project `vcndlorrrtueofzuynvi` ("Sikka Personal Apps" — shared with the old Task Manager and Finance Manager, `atlas_` prefix keeps this app's tables separate). Every table: `id uuid pk default gen_random_uuid()`, `created_at`/`updated_at timestamptz` (server-defaulted, `updated_at` auto-bumped by trigger — see below), `deleted_at timestamptz` nullable. Tables that can be archived also get `archived_at timestamptz` nullable.

Migrations are numbered and live in `Atlas/migrations/`. Never edit an old one — add a new one. Current state: `001_init.sql` through `004_running_note_and_global_notes.sql`, all applied to the live database.

## Tables

### `atlas_projects`
`name` (required), `monogram_letter` (required), `color_key` (required, one of sage/blue/lilac/coral), `description`, `current_focus`, `next_step`, `future_plans`, `status` (planned/in_progress/completed, default planned), `started_at` (date, default today), `target_date`, `order_index`, `cover_image_url` (unused so far), `archived_at`, `deleted_at`.

### `atlas_tasks`
`project_id` (nullable — a task can stand alone), `name` (required), `status` (not_started/in_progress/done, default not_started), `scheduled_date`, `scheduled_time`, `notify_enabled` (bool, default false — toggle only, push itself is Phase 5), `priority` (normal/high, default normal), `completed_at`, `completion_note` (set on complete), `running_note` (added migration 004 — set on start, shown on the "Running now" card), `archived_at`, `deleted_at`.

### `atlas_task_logs`
The project work log. `project_id`, `task_id` (nullable — narrative entries have no task), `entry_date` (date, server-defaulted to today), `body` (required), `entry_type` (`narrative` = you wrote it, `task_completion` = auto-written when a task is completed — this distinction drives the `system-text` vs `user-text` styling), `deleted_at`.

### `atlas_project_notes`
`project_id` — **nullable since migration 004**. The UI only ever writes `project_id = NULL` now (page-level notes on the Projects tab, added after testing feedback that per-project notes were redundant next to focus/next-step/tasks/work-log already on that page). A non-null `project_id` is still schema-valid if ever wanted again, just unused by current UI. `body` (required), `deleted_at`.

### `atlas_notebook_entries`
`entry_date` (unique), `body`, `deleted_at`.

### `atlas_checklist_items`, `atlas_checklist_history`, `atlas_targets`, `atlas_target_logs`
Created in `001_init.sql`, not yet used by any UI — Phase 2 (checklist) and Phase 3 (targets).

## Server-side functions (migration 003 + 004)

Client never invents `deleted_at`/`archived_at`/`updated_at` — a plain JSON payload can't express `now()`, so these transitions go through small database functions instead of a raw `.update()`:

- `atlas_set_updated_at()` — trigger, fires on every `UPDATE` on every table, bumps `updated_at`. Client never sends this field.
- `atlas_projects_{soft_delete,restore_trash,archive,restore_archive}(p_id)`, same set for `atlas_tasks`, plus `atlas_tasks_complete(p_id, p_note)` and `atlas_tasks_start(p_id, p_note)`.
- `atlas_{task_logs,project_notes,notebook_entries}_{soft_delete,restore_trash}(p_id)`.

All `RETURNS SETOF <table> ... RETURNING *` — a real row back = success, zero rows = treat as failed (the verified-write pattern, just via `.rpc()` instead of `.select().single()`). Hard-delete (Restore view only) is a plain guarded `.delete()` — no timestamp involved, so no function needed.

## RLS (migration 002)

Every `atlas_` table: `FOR ALL TO authenticated USING (true) WITH CHECK (true)`. No `profiles` table, no per-row scoping — single-tenant by construction (exactly one account exists, created directly in the Supabase dashboard, no public sign-up in the app). An unauthenticated request gets nothing. See "Authentication" in `CLAUDE.md` for the full reasoning.

## Reliability rules (unchanged from Phase 0)
- Soft delete only, via `deleted_at`. Hard delete only from the Restore view, second confirmation.
- All timestamps server-side, never client-invented.
- UUIDs everywhere, no numeric counters.
