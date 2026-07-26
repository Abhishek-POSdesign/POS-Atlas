# PLAN.md — Atlas state of the world

**Read this at the start of every session, regardless of agent.** It tells you what's actually live vs. what's still on paper vs. what hasn't been touched yet.

Sibling docs:
- [`CLAUDE.md`](CLAUDE.md) — the rules (don't deviate; ask first)
- [`SESSION_LOG.md`](SESSION_LOG.md) — running log of every session (append before ending yours)
- [`handover-docs/CLAUDE.md`](handover-docs/CLAUDE.md) — full history + detail
- [`handover-docs/SLEEP-ROADMAP.md`](handover-docs/SLEEP-ROADMAP.md) — sleep future plan

**Last updated:** 2026-07-26 (end of Design Review Round 2 build) · **Live at:** [atlas.abhisheksikka.com](https://atlas.abhisheksikka.com) · **Current cache version:** `atlas-offline-shell-v19` · **Latest migration:** `013_atlas_workout_add_day_type.sql`

---

## LIVE IN PRODUCTION (as of 2026-07-26)

Everything below is deployed and confirmed on the live app. Anything Antigravity shipped in earlier sessions is included — detected by reading the current code + commit history.

### Authentication & shell
- Real Supabase Auth (email + password). Single-account, one profile, no signup screen — Abhishek's account is provisioned directly in the Supabase dashboard.
- Session persists per-browser (Supabase default).
- Three-state theme switcher (Auto · Light · Dark) permanently visible in top header. Charcoal Muse (dark) and Paper Studio (light) — both fully painted.
- PWA installable: manifest.json + icon-192.png + icon-512.png + favicon.svg + service-worker.js with `skipWaiting` + `clients.claim`. Cache currently `v19`.
- Header actions: Notebook overlay button, Restore overlay button, user name, theme switcher, sign-out.

### Today page — Tasks & Reminders card
- **Fixed-height with internal scroll.** Grid-stretch matches the Sleep + Workout column exactly; task list scrolls inside when it overflows. Card outer height never grows with task count.
- **Row anatomy (v2):** round done-checkbox on the left · task name + kind/project chip metadata stacked in the middle · right-aligned time column with OVERDUE tag underneath if past-due · **no delete X on the row** (delete lives inside Edit).
- **Project chip fix:** tinted `--surface-2` background with hairline border, primary text weight-600, coloured identity dot. Reads clearly on both themes.
- **Overdue state:** past-scheduled tasks/reminders show coral time + "OVERDUE" tag. `isOverdue()` narrowly defined (past date OR today+past time, never done).
- **Two-tap done confirm:** first tap on checkbox arms row with sage-tint + inline hint; second tap within 2.5s commits; expires silently.
- **Edit-on-click:** clicking anywhere on the row (except the checkbox) opens the redesigned task edit modal.
- **Recently completed rows are fully inert** — no cursor, no hover, no click, no delete. Undo via Restore view.
- **Empty state:** three pulsing dots + "Nothing scheduled today" headline + helper (only when both upcoming and recently-completed are empty).

### Today page — Task edit modal (add + edit both use this one)
- **Tiered layout:** eyebrow (e.g. "Task · POS_Testing") + title-sized name input (20 px weight-500) + right-aligned status pill (Not started / In progress / Done).
- **Schedule subsection:** date input + universal numeric time picker + "Notify me at this time" checkbox.
- **Assignment subsection:** type (Task/Reminder) + project (Standalone or one of the active projects).
- **Delete inside modal:** outline-coral button bottom-left, visually separated from Cancel/Save on the right. `askConfirm` modal + undo toast as usual.

### Today page — hero + KPIs + Routine + trend
- **Hero band:** streak card (left) · KPI strip (Tasks today / Active projects / Checklist ring) · streak card (right).
- **Streaks:** 56 px number, "relapse" as a quiet coral text-link (55% opacity, hover underlines), grace-day mechanic + previous-best memory. Modal for relapse confirmation with required reason + optional "use grace" checkbox.
- **KPI cards:** 40 px big number + denominator span for Tasks (`recentlyCompleted/tasksTodayTotal`); 40 px count + colour chip list for Active projects; 128 px ring for Checklist with sage/amber/hollow segments.
- **Checklist Today ring — skipped colour:** `--accent-amber` (was `--border-hover`, invisible). Matches trend chart + mini-dots.
- **Journal pencil:** icon-button next to the Today H1, real hover/focus `.tooltip` in `--surface-2` (not `title=`), toggles the inline daily-note composer.
- **Sleep + Workout column:** two vital-cards, both with `.nodata` two-line helper when unset (names the manual + planned-AI-parse flow).
- **Routine (checklist):** always visible below the 60/40 row. Starts fully collapsed on every mount (session-only, never persisted). Four blocks (Morning/Afternoon/Night/Sleep) with 5 px coloured left-edge. Mini-dots share colour language with the trend chart. Log popup (name + time + note). Log button muted 35% on already-marked rows.
- **Checklist Completion trend:** 30-day stacked bar chart (sage done / amber skipped / coral missed). Legend at 11 px dots + 500-weight secondary text.

### Today page — Sleep (manual entry only)
- One row per day in `atlas_sleep_logs`, keyed on `entry_date UNIQUE` (midnight, not 6am-shifted).
- Fields: duration_minutes, sleep_score, deep_minutes, rem_minutes, resting_hr, hrv, note.
- Modal for logging (three field rows + note).
- No trend chart yet — see PLANNED below.

### Today page — Workout (manual entry + day-type toggle)
- **Day-type chips (Round 2 build):** three chips at the top — Workout · Active recovery · Full rest. Selected chip gets accent-tinted background. Persists per day via `day_type` column (migration 013).
- **Workout state:** metric grid (score / type / minutes / calories / VO2 max) + Edit button surfaces the logging modal.
- **Active recovery state:** calm lilac walking-dot pulse + "Active recovery day / Logged — no details to enter."
- **Full rest state:** pulsing blue moon + "Full rest day / Nothing to log. Sleep well tonight."
- All animations respect `prefers-reduced-motion`.

### Today page — Daily journal
- Hidden by default. Small pencil-icon button next to the H1 toggles `journalOpen`.
- Composer writes to `atlas_notebook_entries` on the midnight-calendar `entry_date` (same table Notebook overlay uses).
- **Date rule locked:** notebook + daily-journal use midnight calendar date. Checklist + streaks use the 6am rollover. See CLAUDE.md.

### Projects list page
- Grid of project cards (monogram + name + description + status + task count on click-to-expand).
- **"+ Add note" button** (Round 2 build): opens a modal composer. Notes only render below after the first save. Persistent empty Notes card removed.
- **New Project modal (Round 2 build):** name + color + monogram + description + optional **Short-term goal + target date + Long-term goal + target date** as a labelled subsection. Create fully-formed in one step.

### Project workspace page
- **Back to Projects** button top-left.
- **Hero card (redesigned Round 2):** coloured project dot + 34 px serif title + status pill on the left · description below · three summary metrics (Tasks done/total + in-progress count · Short-term due + days-until · Long-term due + days-until) · progress bar. On the right: ⋯ overflow menu (Edit goals · Archive project · Delete project) + **both goals stacked** (short-term sage 3 px left-edge · long-term blue 3 px left-edge · weight-500 primary text · no date line inside the goal block, per the countdown-on-the-left convention).
- **Goal-edit modal:** opened by clicking either goal or the ⋯ menu's "Edit goals." Both goals editable together.
- **Running now** section (only when a task is `in_progress`).
- **Tasks section (Round 2 build):** same `.trv2-row` anatomy as Today. No delete X on rows. No persistent add-task input row. `+ Add task` head-action opens the workspace task modal.
- **Workspace task modal:** mirrors Today's shape — same eyebrow + name + Schedule/Assignment tiers + inline Delete. Project field auto-locked to this workspace's project.
- **▶ Start** as a subtle inline button in the meta line for `not_started` tasks — opens the existing `askNote()` "what are you doing right now?" prompt, then transitions to `in_progress`.
- **Two-tap done confirm** on the row's checkbox (same as Today). Completing a task auto-creates a "Completed: {name}" Work log entry.
- **Work log section:** day-grouped, expandable. Add entry form + log lines (time · body · Edit).

### Notebook overlay
- Header icon button toggles the overlay.
- Today's entry composer + "Save" (upsert on `entry_date UNIQUE`).
- Past entries listed below with individual delete + Restore-via-view.

### Restore view (config-driven)
- Header icon button opens the overlay.
- Nine collapsed-by-default sections, each showing count: Projects, Tasks, Notebook entries, Project notes, Task logs, Checklist items, Checklist history, Sleep logs, Workout logs.
- Restore (via RPC) + "Delete forever" (hard delete, second confirmation modal).
- Config-driven via `SECTION_DEFS` — adding a 10th soft-deletable entity is one entry there + matching db.js methods.

### Universal time picker (Round 2 build)
- Shared Alpine `timePicker12h` component + `.tp-numeric` markup: two 2-digit numeric HH/MM inputs + AM/PM segmented control.
- `inputmode="numeric"` opens the OS number pad on mobile.
- Same at every consumer: Today task modal, workspace task modal, checklist Log popup.
- Internal `.value` is still a 24-hour "HH:MM" string; no consumer's read/write code changed.

### Streaks (Phase 2)
- `atlas_targets` rows with `kind='streak'` on the Today hero band.
- Real day count via plain calendar diff from `streak_start_date` (not 6am-shifted).
- Relapse action → modal → `atlas_targets_log_relapse` RPC. Grace day = keeps streak alive, flips `grace_used` true. Otherwise resets `streak_start_date` and updates `previous_best_days`. Reason always required and always logged.

### Sync + reliability
- Local-first: no. Atlas is fully online — every mutation is a live network call.
- Every write verified (`.select().single()` or RPC `RETURNING *`).
- Soft-delete only. `deleted_at IS NULL` filter on every read (Restore view is the exception).
- `askConfirm()` for every destructive action. Never `window.confirm()`.
- 8-second undo toast on every soft-delete.

### Live schema (migrations 001–013)
Every migration applied. Current tables (all `atlas_` prefix, all RLS enabled):
`atlas_projects`, `atlas_tasks`, `atlas_task_logs`, `atlas_project_notes`, `atlas_notebook_entries`, `atlas_checklist_items`, `atlas_checklist_history`, `atlas_sleep_logs`, `atlas_workout_logs` (now with `day_type`), `atlas_targets`, `atlas_streak_relapses`, plus `atlas_activity` (unused placeholder from an early migration).

---

## MOCKUP-ONLY / designed but not yet built

**None as of 2026-07-26.** Design Review Rounds 1 and 2 are both fully shipped; there is no approved mockup sitting in the wings waiting for build. The Round 2 mockup artifact ([https://claude.ai/code/artifact/6569b321-ce74-4c36-a017-d404285123a7](https://claude.ai/code/artifact/6569b321-ce74-4c36-a017-d404285123a7)) is now historical reference — everything in it shipped as commit `2db6348`.

---

## PLANNED but not yet mocked

Nothing in this list is on the current sprint. Each is a candidate for the next design review round when Abhishek re-opens it.

### Sleep — trend chart + AI features
Full plan in [`handover-docs/SLEEP-ROADMAP.md`](handover-docs/SLEEP-ROADMAP.md). Summary:
1. **Trend roll-up chart** — last 30 days of sleep score + duration, same shape as the Checklist Completion bar chart. No schema change; reads `atlas_sleep_logs` directly. Placement TBD (dedicated History overlay recommended).
2. **Screenshot parser** — upload ring/app screenshot → Vertex AI (existing `VERTEX_API_KEY_POS`) → review-before-save modal. Same plumbing serves workout screenshots.
3. **Pattern-of-life insights** — weekly correlations (e.g. "sleep score dropped 8 pts on the four nights you logged a workout after 10pm"). Requires 30+ days of data, so depends on the trend roll-up.

### Workout day-type toggle — weekly pattern setter
Round 2 built the per-day toggle. A follow-up would let Abhishek set default patterns (e.g. "Sundays are always Full Rest by default"). Deferred; ships only if he asks.

### Phase 3 — Targets goal-cards (`count_toward_goal`)
`atlas_targets` already exists with `kind='streak'` shipping. The `count_toward_goal` kind (progress bars, cumulative counters) is the other half — sketched in earlier `plan.md` but not started. Awaits Abhishek's go-ahead.

### Notebook — floating draggable window
Currently a modal overlay. A floating draggable variant (stay open while using the rest of the app) was scoped-out for later. Deferred.

### Time picker — full numpad variant
Round 2 shipped the simpler two-input variant. A phone-clock-app style numpad grid (~120 lines) was flagged as a further follow-up. Deferred.

### Visual-hierarchy pass on Projects list + Notebook
Round 1 covered Today. Round 2 covered the Project workspace. A similar polish pass on the Projects list surface and the Notebook overlay was scoped-out for later. Deferred.

### AI-teacher / conversational layer
The old app has a full AI-layer plan (`handover-docs/AI-LAYER-IMPLEMENTATION-PLAN.md` in the sibling repo). Nothing equivalent has been planned for Atlas. Would be its own multi-round design review if Abhishek wants it.

---

## Open questions / decisions pending

**None active as of 2026-07-26.** Round 2 shipped clean; Abhishek confirmed the direction and the post-mockup date-duplication fix; no clarifying questions were left open at close.

Standing "would want an answer before starting" items — these are not blocking anything now, but they'd need addressing before their respective phase begins:
- **Sleep trend UI placement** — inline under Sleep card, dedicated Sleep tab, or a shared History overlay (recommended: shared overlay so workout inherits it too).
- **Weekly-pattern setter for workout day-types** — is this worth building, or does the per-day toggle cover the real use case well enough?
- **Phase 3 Targets** — does Abhishek still want `count_toward_goal` targets, or is the streak side (which already ships) enough for now?

---

## Recommended next sequence

If Abhishek picks the work back up without a new brief, the sequence I'd suggest:

1. **Live-test the Round 2 build** on the deployed app once the current deploy settles. Real interaction on: fixed-height Tasks card with many tasks, universal numeric time picker on mobile, workout day-type toggle, goals-in-hero, delete-in-edit-modal, project chip contrast on both themes, checklist ring skipped colour.
2. **Fix anything that surfaces from that live test** — treat as a small third pass on the same Round 2 scope. Standard "iterate the artifact if visual, otherwise straight-to-build" flow.
3. **Choose the next design review round.** Options in priority order (my read):
   - **(a) Projects list polish** — the surface hasn't had a hierarchy pass; a few Comet-observation items are still open (colored status dot unclear, "add another project" affordance).
   - **(b) Sleep trend roll-up** — 30-day chart. Small build, high user value, unlocks the AI features later.
   - **(c) Notebook layout pass** — from the same deferred-list bucket as Projects.
4. **AFTER (a)–(c), consider Phase 3 (Targets `count_toward_goal`)** — the streak side is proven, the DB is ready, the workspace hero already has a metrics slot that could host progress numbers. Design-review it first; don't build.
5. **AFTER Phase 3, consider the sleep AI stages** in the order documented in `handover-docs/SLEEP-ROADMAP.md`.

Nothing on this list starts without Abhishek re-opening the conversation.

---

## Hard reminders

- **Read `CLAUDE.md` before writing code.** The rules live there, and they're non-negotiable without asking.
- **Read the last 2–3 `SESSION_LOG.md` entries** at the start of your session — that tells you what the previous agent shipped and any state that isn't in the codebase yet.
- **Append your own `SESSION_LOG.md` entry at the end** — same format. Don't skip.
- **Commit and push after every completed pass in Atlas.** Do not hand off "waiting to push" — Abhishek can't review from localhost.
- **Local dev = production DB.** Do not sign in and click around locally.
