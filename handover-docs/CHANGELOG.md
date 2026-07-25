# Atlas Changelog

All notable changes to the Atlas project will be documented in this file.

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
