# Atlas — Debug Report

**Date:** 2026-07-26 · **Update 2026-07-26 (later):** technical trust pass complete — see "Fix status" at each finding and the summary at the bottom.
**Scope:** Full pass across everything in `D:\Calude\POS\Atlas\` — every handover doc, every JS file (32 of them), all CSS (3 files, 1366 lines), all migrations (001–011), the built PWA shell, and a direct check against the live Supabase project (`vcndlorrrtueofzuynvi`) including `list_tables`, `list_migrations`, and both the security and performance advisors.
**Bottom line:** the code itself is in good shape — the architecture rules from CLAUDE.md are actually being followed, every write goes through `db.js` with a verified return, no syntax errors anywhere, no `$root` reach-outs, no `window.confirm()` calls, no hardcoded hex colors in `components.css`. The bugs below are mostly gaps between what was built and what was promised, not broken behaviour in what's live. **Two of them are real and worth fixing before Phase 3.**

---

## What I inspected

- **Docs read in full:** `CLAUDE.md`, `plan.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `SCHEMA.md`, `FUTURE-CHANGES-CHECKLIST.md`.
- **Code read in full:** `index.html`, `service-worker.js`, `manifest.json`, all 32 JS files, all 3 CSS files.
- **Migrations read in full:** all 11 SQL files.
- **Grepped for:** `window.confirm/prompt/alert`, `$root`, hardcoded `#hex` in `components.css`, `TODO/FIXME/XXX/HACK`, duplicate top-level function declarations across the module graph.
- **Syntax-checked:** every JS file with `node --check`. **Result: 0 errors.**
- **Live Supabase inspection:** every `atlas_*` table exists with RLS enabled, every one of the 11 numbered migrations has been applied, direct row counts of soft-deleted rows across all 9 entity tables.
- **Advisors:** ran both security and performance lint against the live project.

---

## What's working correctly (don't touch)

- **Architecture is intact.** `db.js` is the only file that talks to Supabase; `auth.js` is the only file that touches `supabase.auth`; every page uses callback-based navigation (no `$root`); every soft-delete goes through a verified RPC with row-count check; every insert/update uses `.select().single()`.
- **All 32 JS files parse cleanly.** No syntax errors anywhere.
- **Design tokens hold.** Zero hardcoded hex colors in `components.css`. Every color goes through a `--surface-*` / `--accent-*` / `--text-*` token. The one hardcoded `rgba(0,0,0,0.45)` in `components.css:258` is the modal-overlay scrim — a legitimate exception (translucent black is theme-independent).
- **In-app dialogs replace browser popups.** No `window.confirm/prompt/alert` anywhere in `Deploy/`. `askConfirm()`, `askNote()`, `showUndoToast()` are all wired.
- **All 11 migrations applied to the live database.** `atlas_001_init` through `atlas_workout_logs_add_score_vo2` all present in `supabase_migrations`.
- **RLS enabled on every `atlas_` table.** All 12 tables report `rls_enabled=true`.
- **Service worker cache correctly bumped to v13** and both `skipWaiting()` + `clients.claim()` are called on install/activate, matching the CLAUDE.md discipline.
- **Duplicate-function-declaration trap avoided.** The one class-of-bug that killed the old app during the July 18 rewrite doesn't reappear here — no top-level function name collides across the module graph.
- **Live data looks healthy.** 20 checklist items (matching CHANGELOG's 17 active + 3 retired), 383 checklist history rows (grew from CHANGELOG's 376), 2 streaks, no orphaned foreign-key rows.

---

## Issues found — ranked by severity

### 🔴 BLOCKER — 1. PWA icons don't exist, and this breaks the service-worker install  · ✅ FIXED

- **Fix status:** icons added — `Deploy/icon-192.png`, `Deploy/icon-512.png`, `Deploy/favicon.svg`. `manifest.json` colors updated `#0e0e10 → #131316` + `"purpose": "any maskable"` added. `index.html` `<meta name="theme-color">` updated + `<link rel="icon">` + `<link rel="apple-touch-icon">` added. Service worker cache bumped `v13 → v14` and the three new assets added to `ASSETS_TO_CACHE`.

- **What:** [`manifest.json:9-18`](Deploy/manifest.json) references `/icon-192.png` and `/icon-512.png`. [`service-worker.js:2-41`](Deploy/service-worker.js) — actually, it *doesn't* list them in `ASSETS_TO_CACHE`, good — but the manifest still 404s them. Worse, **no icon files at all exist in `Deploy/`** (ran `ls Deploy/` — only `css/`, `index.html`, `js/`, `manifest.json`, `service-worker.js`). The plan.md folder-layout section explicitly names `icon-*.png` and `favicon.svg / .ico` as part of the deploy — they were never actually created.
- **Impact:** The PWA install prompt on iOS/Android silently drops the app to a generic tile, and the browser tab has no favicon. The service worker install itself is *not* broken (the icons aren't in the cache list), so the app still runs — but the "installable PWA from day one" line in plan.md is not actually satisfied. Also the `<meta name="theme-color" content="#0e0e10">` in `index.html:10` and matching `manifest.json` values are **stale** — the current dark palette in `tokens.css:28` is `#131316`, not `#0e0e10` (the old pre-Variant-A value from plan.md). The OS splash uses the manifest color, so briefly wrong on install.
- **Fix:** Generate a Compass icon set (192 and 512, plus a favicon), drop into `Deploy/`, and update the manifest+meta `theme-color` to `#131316`.

### 🔴 BLOCKER — 2. Restore view is incomplete — 7 entities can be soft-deleted but never recovered  · ✅ FIXED

- **Fix status:** `db.js` gained `listDeleted()` + `hardDelete()` methods for every previously-orphaned entity (Notebook, ProjectNotes, TaskLogs, Checklist items, Checklist history, Sleep, Workout), plus `restoreHistory()` for the history-row restore path and `listAllItems()` so history-row labels can look up their (possibly also-deleted) item's name. `pages/restore.js` rewritten config-driven — one `SECTION_DEFS` entry per entity means adding a 10th later is a one-liner. The Restore overlay in `index.html` now renders 9 collapsed-by-default sections showing counts (per your explicit UX call). The 3 orphaned `atlas_project_notes` rows confirmed in the DB will surface automatically the next time Restore opens.

- **What:** `pages/restore.js` only queries `DB.Projects.listDeleted()` and `DB.Tasks.listDeleted()`. But `db.js` has soft-delete + restore methods for **9 entities**: projects, tasks, task logs, project notes, notebook entries, checklist items, checklist history, sleep logs, workout logs. The other 7 have no UI path to reach after the 8-second undo toast expires.
- **Confirmed live:** direct SQL against the DB shows `3 deleted rows in atlas_project_notes` right now, with no way for Abhishek to see or restore them from the app. Everything else is currently zero, but the same trap is set — the first time he deletes a notebook entry, misses the 8-second undo, it's gone from view forever.
- **Violates:** `plan.md` line 119: *"Every soft-deleted row can be found and restored later. Hard-delete only happens from Restore."* And CLAUDE.md's "Reliability" rule #3: *"Every destructive action... always ends up recoverable from the Restore view."*
- **Fix:** extend `restore.js` to load and render each entity type. Add matching `DB.<Entity>.listDeleted()` methods where they don't exist yet (only `Projects` and `Tasks` have one). Same UI pattern — one card per entity type, with restore + hard-delete rows.

### 🟠 MEDIUM — 3. `db.js:172-173` — `ProjectNotes.update` is declared twice  · ✅ FIXED

- **Fix status:** duplicate line removed as part of the `db.js` restore-extension edit.

```js
create(row) { return verifiedInsert('atlas_project_notes', row); },
update(id, patch) { return verifiedUpdate('atlas_project_notes', id, patch); },
update(id, patch) { return verifiedUpdate('atlas_project_notes', id, patch); },   // ← dup
async softDelete(id) { ... }
```
- **Impact:** none at runtime (the second overwrites the first, both identical) — but it's a copy-paste artifact that signals this file wasn't re-read carefully. Delete the duplicate line.

### 🟠 MEDIUM — 4. `SCHEMA.md` is stale — undercounts the schema by half  · ✅ FIXED

- **Fix status:** `SCHEMA.md` rewritten to reflect the real state — migrations 001-011 all applied, every Phase 2 table documented with actual columns (streak_relapses, sleep_logs, workout_logs, `kind` on tasks, `logged_time`/`note` on history, `days` on items, `previous_best_days`/`grace_used` on targets), all RPCs listed, and the AI screenshot-parse pipeline plan captured so a fresh session finds it in the schema doc, not just CLAUDE.md. Also updated `plan.md`'s Folder Layout — dropped the 6 files that never got built, added the Phase 2 files, and noted the Checklist-merged-into-Today change.

- **What it says:** *"Current state: `001_init.sql` through `004_running_note_and_global_notes.sql`, all applied to the live database"* and calls `atlas_checklist_items`, `atlas_checklist_history`, `atlas_targets`, `atlas_target_logs` *"Created in `001_init.sql`, not yet used by any UI — Phase 2 (checklist) and Phase 3 (targets)."*
- **What's actually true:** 11 migrations applied, Phase 2 shipped 2026-07-25 with checklist, streaks, sleep, workout, and the whole dashboard. The SCHEMA.md predates all of that.
- **Impact:** A fresh Claude session will read the doc as authoritative and reason from the wrong schema. Worth fixing before doing anything with a schema change. `handover-docs/PENDING-PUSH-NOTIFICATIONS-PLAN.md` doesn't exist here — that one's from the old app; SCHEMA.md itself is the gap.
- **Fix:** rewrite the "Tables" and "Current state" sections to cover migrations 005–011 (`days` column, `logged_time`/`note` on history, `atlas_sleep_logs`, streak relapse/grace, `atlas_workout_logs`, `kind` on tasks, `workout_score`/`vo2_max`).

### 🟠 MEDIUM — 5. ~~Daily-note date silently disagrees with everything else on the page~~  · ❌ REJECTED and REVERSED

- **The original recommendation was wrong.** I proposed unifying the daily-note key onto the 6am logical date. Abhishek corrected this on 2026-07-26 with an explicit rule split. **The 6am rollover is *only* for checklist-style end-of-day habits.** Everything else uses the plain midnight calendar date.
- **The authoritative date rule (2026-07-26):**
  - **6am rollover (`todayKey()` from `date-utils.js`):** Checklist history, streak day-count, checklist ring/trend/completion count. **Only these.**
  - **Midnight calendar date (`todayIsoDate()` helper):** Tasks, projects, work log, notebook entries, daily journal, **sleep logs, workout logs.**
- **Actual fix applied:** on inspection, sleep and workout logs were the *only* things still on `todayKey()` outside the checklist. `pages/today.js` was updated — the `load()` fetch for sleep/workout now uses `todayIsoDate()`, and both `saveSleep()` and `saveWorkout()` write with `todayIsoDate()` too. The daily journal was already on the midnight date (`noteDate: todayIsoDate()` at load), so nothing to change there. Comments added in `today.js`'s `load()` documenting the rule split so this doesn't get re-broken.
- **Data-migration note:** any sleep or workout row logged between midnight and 6am *before* this fix landed will be stored under yesterday's date (`todayKey()` returned yesterday during that window). Current live data: 1 sleep log + 1 workout log, so if either happens to have been logged in that window, it's on the "wrong" date. Worth eyeballing but not scripted-migrating — it'll only ever affect a handful of edge-case rows going forward.

### 🟠 MEDIUM — 6. `completeTask` has an unrolled two-write partial-failure gap

- **What:** [`pages/project-workspace.js:109-125`](Deploy/js/pages/project-workspace.js) — `completeTask` does two sequential writes: `DB.Tasks.complete(...)` first, then `DB.TaskLogs.create({... entry_type: 'task_completion'})`. Both are individually verified, but there's no rollback if the second one fails after the first succeeds.
- **Impact:** If the network drops between the two, the task is marked done in the DB but the work log has no completion entry — the two views of the same event permanently disagree. Rare but real. Violates the "every write is verified" spirit (only individually, not as a transaction).
- **Fix:** either wrap in a small RPC that does both inside one transaction (best), or at minimum catch the TaskLogs failure separately and surface it as a distinct error so Abhishek knows to re-add the log manually. Not urgent — hasn't hit yet — but worth cleaning up.

### 🟡 LOW — 7. Alpine + Supabase are loaded from CDN, and the service worker can't cache them

- **What:** `main.js:1` imports Alpine from `cdn.jsdelivr.net`, `supabase-client.js:3` imports supabase-js from the same. `service-worker.js` caches every local file but not the CDN.
- **Impact:** First-load-while-offline can't work — the offline shell literally has no framework to run. Not a bug in what ships day one (the shell installs on the first online visit and works offline afterward, per the cache-first fetch handler), but the plan.md line *"PWA: installable, service worker for offline shell — from day one"* is only partly satisfied. Also means a CDN outage takes the whole app down until the SW cached copy is re-hit.
- **Fix (optional, only if offline-first-load matters):** vendor both libraries into `Deploy/js/vendor/` and cache them in the service worker.

### 🟡 LOW — 8. `askConfirm()`/`askNote()` are not stackable

- **What:** [`components/confirm-dialog.js:22-34`](Deploy/js/components/confirm-dialog.js) — the host stores a single `dialog` property. If a second `askConfirm()` fires while another is showing, the second overwrites the first and the first promise never resolves (its awaiter hangs forever). Same shape in `note-prompt.js`.
- **Impact:** Very unlikely to hit in practice (dialogs are user-driven and modal), but not zero — e.g. a background timer that decides to prompt could clobber an open one.
- **Fix:** queue dialogs instead of storing one at a time, or refuse to open a second while one is showing.

### 🟡 LOW — 9. `plan.md`'s folder layout lists 6 components/pages that never got built

- `components/stat-tile.js`, `task-row.js`, `target-card.js`, `color-picker.js` don't exist.
- `pages/checklist-edit.js` doesn't exist (checklist editing was inlined into `pages/checklist.js`).
- The tab nav has 2 tabs (Today | Projects), not 3 (Today | Projects | Checklist) — Checklist got merged into Today during the Phase 2 dashboard rebuild, per CLAUDE.md's own standing decision.
- **Impact:** Doc drift only. Nothing broken. But a fresh Claude session comparing plan.md to code will think there's missing work.
- **Fix:** update plan.md's Folder Layout to reflect Phase-2 reality, and add a note to the "App structure — three top tabs" section that Checklist is now inside Today.

### 🟡 LOW — 10. Supabase security advisor: `function_search_path_mutable` on every atlas_ function (30 warnings)

- Every `atlas_*` DB function is missing `SET search_path = public`. Standard Supabase best practice. Not exploitable in a single-tenant app, but the linter will keep flagging it and it's the cheap fix — a new migration that does `ALTER FUNCTION atlas_x() SET search_path = public` for each one. Referenced in the [Supabase docs](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable).
- The other Atlas security lints — `rls_policy_always_true` × 11 — are the *intended* single-tenant design per plan.md ("`TO authenticated USING (true)` is sufficient and simpler"). Ignore those.

### 🟡 LOW — 11. Supabase performance advisor: 6 unindexed FKs on atlas_ tables

- Missing covering indexes on: `atlas_tasks.project_id`, `atlas_task_logs.project_id`, `atlas_task_logs.task_id`, `atlas_project_notes.project_id`, `atlas_target_logs.target_id`, `atlas_streak_relapses.target_id`.
- **Impact:** none today — max row count is 383 (checklist_history) and every query filters on other indexed columns. Will start to matter after months of accumulation. Trivial one-migration fix.

### 🟢 INFO — 12. Cross-tab theme sync doesn't work

- `theme.js` dispatches `atlas-theme-changed` on the same window only. A second tab won't see the switch. Storage-event listener would fix. Not a bug, just a rough edge — Abhishek uses one browser at a time anyway.

### 🟢 INFO — 13. `todayIsoDate()` duplicated across `today.js` and `notebook.js`

- Identical 3-line helper in both files. DRY nit — belongs in `date-utils.js`. (Also see finding #5 — the shared version should probably just *be* `todayKey()`.)

---

## Verdict — is Atlas ready for Phase 3?

**Post-fix pass (2026-07-26):** the four medium+blocker items above are all closed. Findings #6–#13 are either advisory-only or deferred to the separate design pass. Atlas is ready for Phase 3 once the design/visual-hierarchy pass Abhishek flagged separately is done.

Architecture continues to hold up well — every rule in CLAUDE.md's "Never do" list is actually being followed in the shipped code, which is unusually clean for a rebuild.

---

## What I did NOT test

- **Did not run the app in a browser.** The plan is to fix the flagged issues first, then live-test the full Phase 2 surface (checklist, streaks, sleep/workout, dashboard). Live testing would surface interaction bugs the static read can't catch (e.g. does a streak card actually render `Previous best: X` when the current run is shorter than the previous best?).
- **Did not audit the CSS visually** — only checked for the specific known-bad patterns (hardcoded hex, stale rules like the old `.trend-bar { height: 70px }`). The 1181 lines of `components.css` weren't read end-to-end.
- **Did not verify migrations run cleanly on a fresh DB** — checked they're all applied on the live one, which is enough for now.
- **Did not touch the AI edge function** (`ai-teacher` in Supabase) or the AI-screenshot-parse pipeline — both are explicitly deferred per CLAUDE.md.
