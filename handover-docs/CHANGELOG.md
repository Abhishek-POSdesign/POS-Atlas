# Atlas Changelog

All notable changes to the Atlas project will be documented in this file.

## Phase 2: Checklist, streaks, Sleep/Workout, Today dashboard rebuild (2026-07-25) — ✅ shipped, live at atlas.abhisheksikka.com

**Checklist built:** block-grouped items (Morning/Afternoon/Night/Sleep), collapsible with a per-block progress bar and mini-dots, a Log popup (time + optional note, then Done/Skip/Holiday/Undo) mirroring the old app's `openChecklistLog()` rather than a simplified inline-button version that shipped first and was rejected for missing the real feature. Item management (add/edit/reorder/archive, including a day-of-week restriction picker) lives inline. Migrated from the old app: 17 active items + 3 retired items holding orphaned history, 376 history rows (verified against the source), 2 real streaks (Sobriety since 2026-05-24, Smoke-free since 2026-06-28).

**Today dashboard rebuilt from three stat tiles into a real dashboard**, after Abhishek stopped a first pass mid-build and required a mockup-first process for the rest (see `CLAUDE.md`'s "Design review process"). Three artifact mockup rounds later: hero band (streak cards with a relapse+grace-day mechanic, KPI strip with real content per card), Tasks & Reminders (60%) beside Sleep+Workout (40%) pinned to equal height, Routine (checklist, no tab/toggle), a 30-day Checklist Completion trend with real hover data.

**New real backend, not just UI:**
- Migration 008: streak relapse/grace-day tracking (`atlas_streak_relapses` table, `atlas_targets.previous_best_days`/`grace_used`, one verified RPC `atlas_targets_log_relapse`) — mirrors the old app's exact rule, checked directly against its source before building.
- Migrations 007/009/011: `atlas_sleep_logs` and `atlas_workout_logs`, manual entry now (duration, score, deep/REM sleep, resting HR, HRV for Sleep; type, score, minutes, calories, VO2 max for Workout), schema ready for an AI-screenshot-parse feature later (confirmed feasible, not built — the Supabase project already has a working Gemini/Vertex integration via the `ai-teacher` edge function).
- Migration 010: `atlas_tasks.kind` (task/reminder) — didn't exist before, needed for the new Add Task modal and task-row display.
- Dark theme relifted ("Variant A" — see `CLAUDE.md`) after a 3-way side-by-side comparison in the mockup.

**Real bugs found and fixed during live testing** (not design opinions):
- Alpine's `:class` binding doesn't merge a mixed array like `['color-x', {collapsed: bool}]` the way Vue does — the object half silently never applied. Caused two real bugs (checklist collapse, the Phase-1 color-swatch picker's selected-state) before being caught and switched to plain string class binding everywhere.
- A markup/CSS class-name mismatch (`class="cl-body"` in markup vs. `.cl-block-body` in the actual collapse rule) reintroduced the same "collapse does nothing" bug during the dashboard rewrite, from a typo, not the binding pattern this time.
- The Checklist Completion trend chart's bigger, approved bars from the mockup were never actually ported into the real app — an old, smaller rule set from before the redesign silently stayed live for a full shipped round.
- "Tasks today" KPI could disagree with the visible completed-task count — `upcomingTasks` had no date scoping at all (all not-done tasks, forever) while the completed list was scoped the opposite way (all-time). Both are now consistently scoped to "today."

**Deferred, explicitly, at Abhishek's request:**
- The AI-screenshot-parse pipeline for Sleep/Workout — confirmed feasible, scoped as its own isolated edge function, not built.
- Floating/draggable Notebook, and a further visual-hierarchy refinement pass — both still carried over unchanged from the Phase 1 deferred list.
- Phase 3 (Targets/goal-cards, the `count_toward_goal` side of `atlas_targets`) — not started.

## Phase 1: Projects, Tasks, Notebook, Restore, real Auth (2026-07-25) — ✅ shipped, live at atlas.abhisheksikka.com

**Authentication (added mid-phase, not in the original plan):** Phase 0 had assumed "no login screen" per the old app's original design. Abhishek asked for real safety instead: email+password via Supabase Auth, no public sign-up in the app (the one account is created directly in the Supabase dashboard so the password never passes through chat), session persists per-browser. Migration 002 adds `TO authenticated USING (true)` RLS to every `atlas_` table.

**Reliability foundation finished for real.** Phase 0 had drafted `001_init.sql` but never actually run it, and `db.js` was a stub with a `null` Supabase client. Both fixed: the migration was applied, `config.js` got the real project URL/key, and `db.js` became a real write-through wrapper. Migration 003 added the server-side transition functions (soft-delete/archive/restore/complete/start) so `deleted_at`/`archived_at`/`completed_at` are never client-invented timestamps — see `SCHEMA.md`.

**Built:** Projects tab (card grid, create/edit, full workspace page — focus/next-step, tasks, work log, future plans), unified task model (start/complete with an optional note, migration 004 added `running_note`), Today dashboard (partial, as planned), Notebook, Restore view, undo toasts on every delete, in-app confirm/note dialogs (`confirm-dialog.js`/`note-prompt.js`) replacing browser `confirm()`/`prompt()`.

**Real bugs found and fixed during testing** (not design opinions — confirmed root causes):
- Alpine.js auto-started before `main.js` finished registering its components, a race that silently broke the whole app every load. Fixed by importing Alpine as a module and calling `Alpine.start()` manually, after registration.
- Notebook's (and Restore's) close button did nothing — `$root` inside a nested page's own `x-data` resolves to that page's own root, not the outer app shell. Fixed by passing an `onClose` callback in instead.
- A completed task's note was captured but never displayed anywhere.
- No delete confirmation existed anywhere, despite the plan's own "confirmation matches severity" promise — added an in-app confirm dialog before every soft-delete.
- Two rounds of "why did my save not show up" turned out to be the service worker serving a stale cached bundle — the cache was never bumped between test rounds in Phase 0/early Phase 1. `service-worker.js` now `skipWaiting()`/`clients.claim()`s and the cache name gets bumped every round.

**Design pass, four rounds of real testing feedback**, converging on: shared `heading-label`/`system-text`/`user-text`/`running-text` classes instead of one-off styling; date-grouped work log and Projects-page notes (moved out of the per-project workspace, reusing `atlas_project_notes` with `project_id` now nullable rather than a new table); project card click-to-expand-summary instead of jumping straight into the workspace. The heading-vs-content hierarchy took three attempts to actually land (weight alone, then weight+brightness, then a filled chip) — see `ARCHITECTURE.md`'s design-system section for why the first two didn't work.

**Deferred to a later phase, explicitly, at Abhishek's request:**
- **Today dashboard richness** (charts/graphs/progress visuals) — deliberately not built yet. Checklist and Targets (Phase 2/3) don't exist yet, so there isn't much real data to visualize; revisit once they do. Chart.js was researched as the fallback option if a real trend chart is ever needed, but the sibling Task Manager app already solves "dashboard feel" with plain hand-drawn SVG rings and no library, which fits Atlas's calm design language better for anything simpler than a real trend-over-time chart.
- **Floating/draggable Notebook** (stay open while using the rest of the app) — a real UI undertaking (positioning, cross-tab persistence, mobile behavior), not attempted this phase.
- **General visual hierarchy** — Abhishek flagged that the current heading-chip treatment is usable but uniform ("exposed the same rule on everything") and wants a further refinement pass in a later phase, not now.

## [Unreleased]
### Phase 0: Foundation Setup
- **Architecture**: Established strictly layered architecture (`db.js`, `auth.js`, `entities/`, `pages/`, `components/`).
- **Database**: Created `migrations/001_init.sql` defining 9 core tables (`atlas_projects`, `atlas_tasks`, etc.) with UUIDs, `deleted_at` soft deletes, and RLS enabled.
- **Styling**: Locked Charcoal Muse (dark) and Paper Studio (light) design tokens in `Deploy/css/tokens.css`.
- **Theming**: Implemented single cycling button logic (Dark -> Auto -> Light -> Dark) via `Deploy/js/theme.js` and `Deploy/js/components/theme-switcher.js`.
- **Entities**: Generated empty shape/validation scaffolds for all 9 entities inside `Deploy/js/entities/`.
- **Deployment**: Finalized `.github/workflows/deploy-atlas.yml` mirroring the proven MilesWeb SSH target pattern (`atlas.abhisheksikka.com/`) with isolated deployment triggers.
- **Documentation**: Initialized `SCHEMA.md`, `ARCHITECTURE.md`, `FUTURE-CHANGES-CHECKLIST.md` and consolidated `plan.md` & `CLAUDE.md` into the `handover-docs/` folder.
- **Source Control**: Cleaned up branching structure, ensuring `main` is the primary and only tracking branch.
