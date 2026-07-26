# Atlas Schema

Supabase project `vcndlorrrtueofzuynvi` ("Sikka Personal Apps" — shared with the old Task Manager and Finance Manager, `atlas_` prefix keeps this app's tables separate). Every table: `id uuid pk default gen_random_uuid()`, `created_at`/`updated_at timestamptz` (server-defaulted, `updated_at` auto-bumped by trigger — see below), `deleted_at timestamptz` nullable. Tables that can be archived also get `archived_at timestamptz` nullable.

Migrations are numbered and live in `Atlas/migrations/`. Never edit an old one — add a new one. **Current state: `001_init.sql` through `015_sleep_morning_note.sql`, all applied to the live database (last verified 2026-07-27).**

## Tables

### `atlas_projects`
`name` (required), `monogram_letter` (required), `color_key` (required, one of sage/blue/lilac/coral), `description`, `short_term_goal` (added migration 012), `short_term_goal_date` (added migration 012), `long_term_goal` (added migration 012), `long_term_goal_date` (added migration 012), `status` (planned/in_progress/completed, default planned), `started_at` (date, default today), `order_index`, `cover_image_url` (unused so far), `archived_at`, `deleted_at`. 
*(Note: `current_focus`, `next_step`, `future_plans`, and `target_date` were retained in DB in migration 012 for safety, but are fully deprecated in the entity/UI).*

### `atlas_tasks`
`project_id` (nullable — a task can stand alone), `name` (required), `kind` (`task`/`reminder`, default `task` — added migration 010, drives the dashboard's Add Task modal and task-row rendering), `status` (not_started/in_progress/done, default not_started), `scheduled_date`, `scheduled_time`, `notify_enabled` (bool, default false — toggle only, push itself is Phase 5), `priority` (normal/high, default normal), `completed_at`, `completion_note` (set on complete), `running_note` (added migration 004 — set on start, shown on the "Running now" card), `archived_at`, `deleted_at`.

### `atlas_task_logs`
The project work log. `project_id`, `task_id` (nullable — narrative entries have no task), `entry_date` (date, server-defaulted to today), `body` (required), `entry_type` (`narrative` = you wrote it, `task_completion` = auto-written when a task is completed — this distinction drives the `system-text` vs `user-text` styling), `deleted_at`.

### `atlas_project_notes`
`project_id` — **nullable since migration 004**. The UI only ever writes `project_id = NULL` now (page-level notes on the Projects tab, added after testing feedback that per-project notes were redundant next to focus/next-step/tasks/work-log already on that page). A non-null `project_id` is still schema-valid if ever wanted again, just unused by current UI. `body` (required), `deleted_at`.

### `atlas_notebook_entries`
`entry_date` (unique), `body`, `deleted_at`.

### `atlas_checklist_items`
`name` (required), `block` (required — `morning`/`afternoon`/`night`/`sleep`; `floating` also exists on 3 migrated retired items, deliberately not offered in the new-item picker), `icon` (optional emoji), `order_index`, `active` (bool), `days` (`INTEGER[]` — added migration 005, day-of-week restriction, `0`=Sunday…`6`=Saturday, NULL = every day), `archived_at`, `deleted_at`. **Live counts (2026-07-26): 20 total (17 active + 3 archived-retired).**

### `atlas_checklist_history`
One row per (item, entry_date). `item_id` (FK), `entry_date` (date), `status` (`done`/`skipped`/`holiday`/`missed`), `logged_time` (time, added migration 006 — user-entered time-of-completion from the Log popup), `note` (text, added migration 006 — user-entered per-mark note), `deleted_at`. **`UNIQUE(item_id, entry_date)`** — one status per item per day. `Checklist.setStatus` upserts on this constraint and clears `deleted_at`, so re-marking a day whose entry was previously undone (soft-deleted via `undoStatus`) revives the same row instead of colliding with it. **Live counts (2026-07-26): 383 rows.**

### `atlas_targets`
`name` (required), `kind` (`streak`/`count_toward_goal`), `goal_value`, `current_value`, `streak_start_date` (date — day-count is derived client-side as `today − streak_start_date`), `previous_best_days` (int, added migration 008 — set on relapse-reset via `GREATEST(old_best, current_run)`), `grace_used` (bool, default false, added migration 008 — once-per-streak-life forgiveness flag), `color_key`, `archived_at`, `deleted_at`. **Phase 2 uses `kind='streak'` only. Phase 3 will add the `count_toward_goal` side using the same table.** Live: 2 streak rows (Sobriety since 2026-05-24, Smoke-free since 2026-06-28).

### `atlas_streak_relapses`
Added migration 008. `target_id` (FK), `occurred_date` (date, default today), `days` (int — how long the streak had run when the relapse happened), `reason` (text, required), `was_grace` (bool). Append-only; every relapse is logged, whether it triggered a real reset or a grace-day save. Zero rows live.

### `atlas_target_logs`
Created in `001_init.sql` for the Phase 3 `count_toward_goal` flow. Not written or read by any current UI. `target_id`, `entry_date`, `value_delta` (int), `note`.

### `atlas_sleep_logs`
Added migration 007, extended migration 015. `entry_date` (**unique**, one row per day, upserted on this constraint), `duration_minutes`, `sleep_score`, `start_time`, `deep_minutes`, `rem_minutes`, `light_minutes`, `awake_minutes`, `resting_hr`, `hrv` (numeric), `note`, `morning_note` (text, added migration 015 — subjective morning reflection, distinct from the general `note`), `deleted_at`. **Keyed on the plain midnight calendar date** (Abhishek's 2026-07-26 rule: sleep is a real sleep cycle across night/morning, not habit-shifted like the checklist).

### `atlas_workout_logs`
Added migration 009, extended migrations 011 + 013. `entry_date` (**unique**), `duration_minutes`, `workout_type` (text), `workout_score` (int, added migration 011), `calories`, `vo2_max` (numeric, added migration 011), `day_type` (text, added migration 013 — `workout`/`active_recovery`/`full_rest`, nullable), `note`, `deleted_at`. **Keyed on the plain midnight calendar date.**

### `atlas_workout_sessions`
Added migration 014. Child table of `atlas_workout_logs` — multiple sessions per day (e.g. strength AM + walk PM). `workout_log_id` (FK, CASCADE delete), `activity_type` (required — `strength`/`cardio_walk`/`yoga_stretch`/`active_play`/`cleaning`), `duration_minutes`, `intensity` (nullable — `light`/`moderate`/`hard`, strength only), `program_tag` (nullable — `upper`/`lower`/`push`/`pull`/`legs`/`full_body`, strength only), `note`, `created_at`. **No `deleted_at`** — sessions live/die with their parent log. **No `updated_at`** — write-once (delete + re-add to edit).

### `atlas_workout_targets`
Added migration 014. Weekly activity targets — how many days/week each type should happen. `activity_type` (**unique** — `strength`/`cardio_walk`/`yoga_stretch`/`active_play`/`cleaning`), `target_days_per_week` (int, default 1), `note`, `updated_at`. Small fixed set, rarely changed.

### `atlas_health_settings`
Added migration 014. Single-row config table for health-related preferences. `sleep_goal_minutes` (int, default 420 = 7h), `updated_at`. Upserted (one row ever exists).

## Server-side functions

Client never invents `deleted_at`/`archived_at`/`completed_at`/`updated_at` — a plain JSON payload can't express `now()`, so those transitions go through small database functions instead of a raw `.update()`. All are `RETURNS SETOF <table> ... RETURNING *` — a real row back = success, zero rows = treat as failed (the verified-write pattern, just via `.rpc()` instead of `.select().single()`).

- **Trigger:** `atlas_set_updated_at()` fires `BEFORE UPDATE` on every table, bumps `updated_at`. Client never sends this field.
- **`atlas_projects`** (migration 003): `_soft_delete`, `_restore_trash`, `_archive`, `_restore_archive`.
- **`atlas_tasks`** (migrations 003 + 004): `_soft_delete`, `_restore_trash`, `_archive`, `_restore_archive`, `_complete(p_id, p_note)`, `_start(p_id, p_note)`.
- **`atlas_task_logs`, `atlas_project_notes`, `atlas_notebook_entries`** (migration 003): `_soft_delete`, `_restore_trash` each.
- **`atlas_checklist_items`** (migration 005): `_soft_delete`, `_restore_trash`, `_archive` (also flips `active=false`), `_restore_archive` (also flips `active=true`).
- **`atlas_checklist_history`** (migration 005): `_soft_delete`, `_restore_trash`.
- **`atlas_sleep_logs`, `atlas_workout_logs`** (migrations 007 + 009): `_soft_delete`, `_restore_trash` each.
- **`atlas_targets_log_relapse(p_id, p_current_days, p_reason, p_use_grace)`** (migration 008, `LANGUAGE plpgsql`): the streak relapse+grace transition. If `p_use_grace` and `grace_used=false`, flips `grace_used=true` and leaves `streak_start_date` alone (the run survives). Otherwise resets `streak_start_date=CURRENT_DATE`, `grace_used=false`, and updates `previous_best_days = GREATEST(old_best, p_current_days)`. Logs the relapse row either way. `p_current_days` is passed in from the client (already computed for display), not re-derived server-side.

Hard-delete (Restore view only) uses a plain guarded `.delete()` with `.not('deleted_at', 'is', null)` — no timestamp involved, so no function needed. `verifiedHardDelete()` in `db.js` refuses to touch a row unless `deleted_at IS NOT NULL`.

## RLS (migration 002 + later)

Every `atlas_` table (including the ones added in later migrations — `atlas_sleep_logs`, `atlas_workout_logs`, `atlas_streak_relapses`, `atlas_workout_sessions`, `atlas_workout_targets`, `atlas_health_settings`): `FOR ALL TO authenticated USING (true) WITH CHECK (true)`. No `profiles` table, no per-row scoping — single-tenant by construction (exactly one account exists, created directly in the Supabase dashboard, no public sign-up in the app). An unauthenticated request gets nothing. See "Authentication" in `CLAUDE.md` for the full reasoning.

Supabase's advisor flags these `USING (true)` policies as `rls_policy_always_true` — this is **expected and intended**. Do not "fix" them without explicit approval.

## Reliability rules (unchanged from Phase 0)
- Soft delete only, via `deleted_at`. Hard delete only from the Restore view, second confirmation.
- All timestamps server-side, never client-invented.
- UUIDs everywhere, no numeric counters.

## Related planned but not built
- **AI screenshot-parse pipeline for Sleep and Workout** (deferred, not scheduled): Abhishek uploads a Garmin/ring/workout-app screenshot; a small isolated Supabase edge function calls Gemini via Vertex to parse the numeric fields; he reviews the parsed values before they hit `atlas_sleep_logs` / `atlas_workout_logs`. The infrastructure already exists in this Supabase project — the sibling old app has a working `ai-teacher` edge function using the secret `VERTEX_API_KEY_POS` — so this is a straightforward "add a second edge function" build when it lands. Until it does, manual entry via the Log Sleep / Log Workout modals stays the only way in.
- **Phase 3 targets (`kind='count_toward_goal'`)** — uses the same `atlas_targets` table plus `atlas_target_logs` (already created in `001_init.sql`, currently unused).
- **Phase 5 push notifications** — will add `atlas_push_subscriptions` + `atlas_push_log` via a new migration when scheduled.
