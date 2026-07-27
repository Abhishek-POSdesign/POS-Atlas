# PLAN.md â€” Atlas state of the world

**Read this at the start of every session, regardless of agent.** It tells you what's actually live vs. what's still on paper vs. what hasn't been touched yet.

Sibling docs:
- [`CLAUDE.md`](CLAUDE.md) â€” the rules (don't deviate; ask first)
- [`SESSION_LOG.md`](SESSION_LOG.md) â€” running log of every session (append before ending yours)
- [`handover-docs/CLAUDE.md`](handover-docs/CLAUDE.md) â€” full history + detail
- [`handover-docs/SLEEP-ROADMAP.md`](handover-docs/SLEEP-ROADMAP.md) â€” sleep future plan

**Last updated:** 2026-07-27 (Final polish pass: Insight Pill contrast fixed, Tasks & Reminders rows now show date+time, Workout tint softened to amber, Smoke-free streak tint softened to amber for visual consistency) Â· **Live at:** [atlas.abhisheksikka.com](https://atlas.abhisheksikka.com) Â· **Current cache version:** `atlas-offline-shell-v38` Â· **Latest migration:** `015_sleep_morning_note.sql`

---

## LIVE IN PRODUCTION (as of 2026-07-26)

Everything below is deployed and confirmed on the live app. Anything Antigravity shipped in earlier sessions is included â€” detected by reading the current code + commit history.

### Authentication & shell
- Real Supabase Auth (email + password). Single-account, one profile, no signup screen â€” Abhishek's account is provisioned directly in the Supabase dashboard.
- Session persists per-browser (Supabase default).
- Three-state theme switcher (Auto Â· Light Â· Dark) permanently visible in top header. Charcoal Muse (dark) and Paper Studio (light) â€” both fully painted.
- PWA installable: manifest.json + icon-192.png + icon-512.png + favicon.svg + service-worker.js with `skipWaiting` + `clients.claim`. Cache currently `v19`.
- Header actions: Notebook overlay button, Restore overlay button, user name, theme switcher, sign-out.

### Today page â€” Tasks & Reminders card
- **Full-width band of its own (2026-07-27 Health restructure).** No longer sharing a row with Sleep/Workout â€” the old 60/40 split put Health inside Tasks' shadow and produced dead space beside the shorter column. Tasks now gets the full page width; Sleep + Workout moved to their own row below (see "Health row").
- Card height follows its own content (no explicit max-height/scroll-cage currently in `.task-list` CSS â€” note this is a pre-existing gap from before the restructure, not something this pass introduced or removed).
- **Row anatomy (v2):** round done-checkbox on the left Â· task name + kind/project chip metadata stacked in the middle Â· right-aligned time column with OVERDUE tag underneath if past-due Â· **no delete X on the row** (delete lives inside Edit).
- **Right column now shows date + time together (2026-07-27):** was time-only (or a raw unformatted date string if no time). New shared `window.formatTaskDateTime(dateStr, timeStr)` helper in `js/main.js` (alongside `formatTime12h`, same pattern) renders `"Jul 27 Â· 10:00 PM"` â€” used identically here and in the Project workspace Tasks section, both consumers of the same `.trv2-row` markup. Left side (project chip, kind label) is unchanged â€” confirmed with Abhishek before building, since his own spec listed project info on both sides for dashboard rows, which would have been genuinely redundant; the resolved answer was left-only, right gets just date+time for dashboard (workspace additionally gets a status tag â€” see the workspace section).
- **Project chip fix:** tinted `--surface-2` background with hairline border, secondary text weight-500 (softened from 600 so it doesn't read too loudly), coloured identity dot. Reads clearly on both themes.
- **Overdue state:** past-scheduled tasks/reminders show coral time + "OVERDUE" tag. `isOverdue()` narrowly defined (past date OR today+past time, never done).
- **Two-tap done confirm:** first tap on checkbox arms row with sage-tint + inline hint; second tap within 2.5s commits; expires silently.
- **Edit-on-click:** clicking anywhere on the row (except the checkbox) opens the redesigned task edit modal.
- **Recently completed rows are fully inert** â€” no cursor, no hover, no click, no delete. Undo via Restore view.
- **Empty state:** three pulsing dots + "Nothing scheduled today" headline + helper (only when both upcoming and recently-completed are empty).

### Today page â€” Task edit modal (add + edit both use this one)
- **Tiered layout:** eyebrow (e.g. "Task Â· POS_Testing") + title-sized name input (20 px weight-500) + right-aligned status pill (Not started / In progress / Done).
- **Schedule subsection:** date input + universal numeric time picker + "Notify me at this time" checkbox.
- **Assignment subsection:** type (Task/Reminder) + project (Standalone or one of the active projects).
- **Delete inside modal:** outline-coral button bottom-left, visually separated from Cancel/Save on the right. `askConfirm` modal + undo toast as usual.

### Today page â€” hero + KPIs + Routine + trend
- **Hero band:** streak card (left) Â· KPI strip (Tasks today / Active projects / Checklist ring) Â· streak card (right).
- **Streaks:** 56 px number, "relapse" as a quiet coral text-link (55% opacity, hover underlines), grace-day mechanic + previous-best memory. Modal for relapse confirmation with required reason + optional "use grace" checkbox.
- **KPI cards:** 40 px big number + denominator span for Tasks (`recentlyCompleted/tasksTodayTotal`); 40 px count + colour chip list for Active projects; 128 px ring for Checklist with sage/amber/hollow segments.
- **Checklist Today ring â€” skipped colour:** `--accent-amber` (was `--border-hover`, invisible). Matches trend chart + mini-dots.
- **Journal pencil:** icon-button next to the Today H1, real hover/focus `.tooltip` in `--surface-2` (not `title=`), toggles the inline daily-note composer.
- **Health row (2026-07-27 restructure):** Sleep + Workout panels sit in their own full-width row below Tasks, not squeezed into a 40% column beside it. Plain CSS grid (`display:grid; grid-template-columns:1fr 1fr`, default `align-items:stretch`) equalizes both panel heights automatically â€” no scroll cage, no min/max plumbing needed. Single column under 900px. Both panels have `.nodata` two-line helper when unset (names the manual + planned-AI-parse flow).
- **CONFIRMED (2026-07-27):** Sleep carries `tint-sage`, Workout carries `tint-amber` â€” a faint gradient wash (`linear-gradient(180deg, var(--accent-*-tint), var(--surface-1) 38%)`, same tint-token pattern as `.kpi-card.hero`/`.streak-card.color-*`) concentrated behind the header, fading to plain `--surface-1` before the note chips/session pills. Header icon chips match (sage/amber). **Workout was originally coral, softened to amber same day** â€” coral read as alarm/danger since it's the app's destructive/caution accent everywhere else (Delete buttons, overdue tags); amber keeps "effort/active" energy without the danger connotation, while staying visibly distinct from Sleep's sage "rest/calm." The **Smoke-free streak** (which previously used the same coral color) was also updated to use the amber tint to match this new visual theme, leaving coral purely as a semantic warning color. Delete buttons inside the Workout panel are untouched, still coral (semantic, unrelated to this decorative wash). `.tint-coral`/`.health-panel-icon.coral` are left defined, unused but harmless. Abhishek confirmed the Health row "matches my intent and is closed for Phase 5" â€” do not revisit this without him reopening it.
- **Routine (checklist):** always visible below the Health row. Starts fully collapsed on every mount (session-only, never persisted). Four blocks (Morning/Afternoon/Night/Sleep) with 5 px coloured left-edge. Mini-dots share colour language with the trend chart. Log popup (name + time + note). Log button muted 35% on already-marked rows.
- **Checklist Completion trend:** 30-day stacked bar chart (sage done / amber skipped / coral missed). Legend at 11 px dots + 500-weight secondary text.

### Today page â€” Sleep panel (manual entry, lives in the Health row)
- One row per day in `atlas_sleep_logs`, keyed on `entry_date UNIQUE` (midnight, not 6am-shifted).
- Fields: duration_minutes, sleep_score, deep_minutes, rem_minutes, resting_hr, hrv, note, morning_note.
- Modal for logging (two-step: metrics, then morning reflection).
- **Header promoted (2026-07-27, post-Comet review):** "Sleep" 13px â†’ 17px/700, plus a 28px lilac icon chip (`.health-panel-icon.lilac`) matching the hero KPI card language. Edit/Log button upgraded from a bare text link to a bordered pill (`.health-edit-btn`, shared class with Workout's).
- **Notes redesigned as three selector-PILL chips (2026-07-27, v4 â€” true two-layer depth):** "Tonight's summary" (reuses the existing `sleepSummary` getter, unchanged) / "Morning reflection" / "Context", each with a tiny icon (moon / sun / message-square) in `.health-chip-head`. The three chips sit inside a shared `.health-chip-stack` "track" (`--surface-2`, 4px padding, 12px radius) with each `.health-chip` rendered as a raised "pill" (`--surface-1` + `var(--top-edge), var(--shadow-card)`, 9px radius) â€” the exact same two-layer depth system as the Workout day-type toggle (`.wo-daytype-group` track / `.wo-daytype-chip[aria-pressed="true"]` pill), just with all three pills permanently "active" since they're always simultaneously relevant. Gentle `translateY(-2px)` + shadow-upgrade on hover, using the same `--dur-base`/`--ease-out` tokens every other card-hover in the app uses. An empty chip shows italic placeholder text (`.health-chip-value.inactive`) instead of disappearing. This is the third and (per Abhishek's "almost satisfied, ship it") final iteration of the sleep-notes treatment: `.sleep-card-note` colored-chip box â†’ `.health-note` plain-divider â†’ `.health-chip` flat card â†’ `.health-chip` pill-depth.
- **Inline 14-day trend, sparkline with sage/coral echo (2026-07-27, v4):** bottom-anchored SVG line + soft sage gradient fill + dashed goal reference line, computed by the `sleepSparkline` getter (`js/pages/today.js`) from `sleepTrendDays`/`sleepGoalMinutes` â€” only real logged nights become points, a missing night is a gap in the line (never a fake flat value). Chart height 46px â†’ 80px. The line itself is drawn as individual `<line>` segments (not one `<polyline>`) so each segment can carry its own sage/coral colour depending on whether that night was above or below the goal line (`sleepSparkline.segments[i].above`) â€” same at-a-glance scoring the old bar chart gave, without going back to bars. The gradient area fill stays a single soft sage wash regardless, so the colour shift reads as an accent, not a second chart. Coloring goes entirely through CSS classes (`.health-spark-line.above/.below`, `.health-spark-dot.above/.below`), never inline `var()` in SVG attributes.
- **"Attach screenshot (future AI)" placeholder (2026-07-27):** small inline text+icon link (`.health-attach-link`) â€” `disabled`, no upload logic, no Supabase field.

### Today page â€” Workout panel (manual entry + day-type toggle, lives in the Health row)
- **Header promoted (2026-07-27, v3):** same treatment as Sleep â€” 17px/700 title + 28px blue icon chip. Exactly two header actions (gear for targets, `.health-edit-btn` pill for sessions) â€” this was already the minimal set, just visually upgraded.
- **Day-type chips (Round 2 build):** three chips at the top â€” Workout Â· Active recovery Â· Full rest. Selected chip gets accent-tinted background. Persists per day via `day_type` column (migration 013).
- **Content reordered (2026-07-27, v3, post-Comet review):** Day-type toggle â†’ **Today's sessions (main focus, unmoved visual style â€” no colored bars, no emoji)** â†’ "This week" targets strip (`.health-targets-strip`, demoted) â†’ 4-week consistency. Previously targets sat above sessions; Abhishek/Comet flagged that as backwards from what actually gets looked at first.
- **Session row controls consolidated (2026-07-27, v3):** the two spaced `.btn-text` Edit/Delete links replaced with one tight icon-button group (`.wo-session-actions-v2` / `.wo-icon-btn`, pencil + trash). Same underlying `openWorkoutSessionForm()`/`deleteWorkoutSession()` calls, unchanged â€” `deleteWorkoutSession()`'s `askConfirm()` delete-confirm flow was not touched.
- **Session rows get the same selector-pill depth as the Sleep chips (2026-07-27, v5):** Abhishek explicitly flagged that the pill treatment landed on Sleep but not Workout â€” `.wo-session-stack` (new track, `--surface-2`, 4px padding, 12px radius) now wraps the session list, and `.wo-session-row` itself is the raised pill (`--surface-1` + `var(--top-edge), var(--shadow-card)`, same hover lift as the sleep chips). Each row also gets a small muted icon (`.wo-session-icon`, `--text-secondary`, NOT colour-coded per activity type) via the new `sessionIconSvg(type)` helper in `today.js` â€” a fixed 5-entry lookup (strength/cardio_walk/yoga_stretch/active_play/cleaning) rendered with `x-html` (safe: `type` only ever comes from the session form's fixed `<select>`, never free text). `.wo-session-actions-v2`'s own background flipped `--surface-1`â†’`--surface-2` so the Edit/Delete icon cluster still reads as a distinct control now that the row underneath it is `--surface-1`. Only Today's inline session list changed â€” the separate "Workout Sessions" modal list keeps its own unrelated `.card.panel` row style.
- **Weekly targets strip:** `--surface-2` recessed block, no border, "This week" micro-label above it.
- **Active recovery state:** calm lilac walking-dot pulse + "Active recovery day / Logged â€” no details to enter."
- **Full rest state:** pulsing blue moon + "Full rest day / Nothing to log. Sleep well tonight."
- **4-week consistency, redesigned as an aggregated weekly strip (2026-07-27, v3):** one larger cell per week (`.health-week-cell`, 38Ã—38px) instead of a dot per activity-type per week â€” computed by the `workoutWeekAggregate` getter (`js/pages/today.js`), purely derived from the existing `workoutConsistency`/`workoutTrendWeeks` data (no new loading, no schema change). A week is 'met' only if every activity type hit its target, 'missed' only if none did, else 'partial'. Shared legend (`.health-legend`) **right-aligned on the "4-WEEK CONSISTENCY" caption line (2026-07-27, v4)**, mirroring how "Avg" sits next to "14-DAY TREND" on Sleep â€” saves a line of vertical space vs. the legend sitting below the cells.
- **"Attach screenshot (future AI)" placeholder:** same small inline link treatment as Sleep's.
- All animations respect `prefers-reduced-motion`.

**Removed 2026-07-27 (morning pass):** the standalone full-width "Health Trends" card that used to sit at the very bottom of Today, with its own Sleep/Workout tab toggle â€” both trends now live inline in their respective panel. `loadHealthTrend()` and its underlying data (`sleepTrendDays`, `workoutConsistency`, `sleepAvg7`) are unchanged; only where/how the template reads them has changed (twice, same day) â€” first to compact bars/dot-rows, then to the sparkline/aggregated-strip described above after a Comet visual review flagged the first pass as still not right.

**Known pre-existing bug found in passing, not yet fixed (2026-07-27):** a small region of `Deploy/css/components.css` (the `.project-card-completed`/`.running-card`/`.running-note`/`.trv2-pause-reason` rules, tagged "/* v1.2 updates */") is encoded as UTF-16 with embedded NUL bytes inside the otherwise-UTF-8 file â€” almost certainly means `.running-card`/`.running-note`/`.trv2-pause-reason` render unstyled in production today, since a NUL byte in a stylesheet becomes U+FFFD and breaks those selectors. `.project-card-completed` has a working duplicate defined correctly elsewhere in the file, so it's unaffected. Unrelated to Phase 5 Health â€” flagged as a spawned task, not fixed in this pass.

### Today page â€” Daily journal
- Hidden by default. Small pencil-icon button next to the H1 toggles `journalOpen`.
- Composer writes to `atlas_notebook_entries` on the midnight-calendar `entry_date` (same table Notebook overlay uses).
- **Date rule locked:** notebook + daily-journal use midnight calendar date. Checklist + streaks use the 6am rollover. See CLAUDE.md.

### Projects list page
- Grid of project cards (monogram + name + description + status + task count on click-to-expand).
- **Separation of states:** Divided into "Running Projects" and "Completed Projects" sections.
- **Completed cards visual state:** Uses `.project-card-completed` (lilac tint surface), replacing the initials with the native checkmark SVG, and featuring a clean `.system-text` "Completed" caption without any faked timestamps.
- **"+ Add note" button** (Round 2 build): opens a modal composer. Notes only render below after the first save. Persistent empty Notes card removed.
- **New Project modal (Round 2 build):** name + color + monogram + description + optional **Short-term goal + target date + Long-term goal + target date** as a labelled subsection. Create fully-formed in one step.
- **"Running: X" mini Insight Pill (2026-07-27, Phase 5 close-out; contrast fixed same day):** inside an expanded project card, if a task is `in_progress`, that line renders as `.insight-pill.insight-pill-mini` â€” `--accent-blue-tint-hover` background (bumped up from the base `-tint`, which was blending into the already-`--surface-2` `.card-nested` it sits in), label+body inline. Just that one line is wrapped, not the whole card. Deliberately quieter than the workspace's full Running Now band â€” a hint, not the main focus. `.running-text`'s old plain-blue-text treatment is superseded here but the class itself is left defined (documented shared utility, not dead code).

### Project workspace page
- **Back to Projects** button top-left.
- **Hero card:** coloured project dot + 34 px serif title + status pill on the left â€¢ description below â€¢ three summary metrics â€¢ progress bar. On the right: â‹® overflow menu (Edit goals â€¢ Mark as completed / Reopen project â€¢ Archive project â€¢ Delete project) + goals stacked.
- **Goal cards are now Insight Pills (2026-07-27, Phase 5 close-out; contrast + sizing fixed same day):** Short-term goal (flag icon) / Long-term goal (trending-up icon), each `.insight-pill.clickable.goal` â€” `--surface-0` body (darker than the `--surface-1` card it sits on, in both themes â€” see the P3 bed-colour fix below), 17px vertical padding (was 12px), 15px/500 body text on goals specifically (`.insight-pill.goal .insight-pill-body`, one step up from the 14px shared default â€” "one step below the project name, not three"), icon+caption head, hover lift (`translateY(-1px)` + background steps up to `--surface-1`). Supersedes the old `.ws-goal` colored-left-edge treatment (sage/blue border, a previously "locked" decision explicitly revisited this session at Abhishek's request â€” see `SESSION_LOG.md`). Same `startEditHeader()` click/keyboard behavior and goal-edit modal, unchanged.
- **Goal-edit modal:** opened by clicking either goal or the â‹® menu's "Edit goals." Both goals editable together.
- **"Running now" is now an Insight Pill (2026-07-27, Phase 5 close-out; typography fixed same day):** the `.ws-section` shell is unchanged, but its content is now a single `.insight-pill` (play-triangle icon, "Running now" caption, task name as body, `running_note` as a smaller italic note below) instead of the old `.heading-label`/`.focus-text`/`.system-text` combo (which had been sitting on the broken `.running-card` class â€” see the "known pre-existing bug" note above; this pass stopped using `.running-card` entirely rather than fixing it in place). Task name uses a dedicated `.insight-pill-running-name` class (16px/600 â€” bigger/bolder than the shared `.insight-pill-body`, since here it's the pill's sole primary line and needs to dominate the small caption above it).
- **Tasks section:** same `.trv2-row` anatomy as Today, same right-column date+time treatment (below) plus a status tag. Task pause/resume mechanics exist (clicking "Pause task" in the edit modal resets it to `not_started`). **Intentionally NOT converted to Insight Pills** â€” Abhishek explicitly scoped this out; the full Tasks & Reminders list is planned as its own future redesign phase.
- **Right column now shows a status tag for not-done tasks (2026-07-27):** reuses the existing `.task-edit-status` pill (from the task edit modal, not a new component) below the date/time â€” "Not started"/"In progress"/"Paused", `.in-progress` gets the sage-tint treatment, others stay the muted default. Moved OFF the left meta line, which used to append "Â· In progress"/"Â· Done"/"Â· Paused" there â€” that's now just plain "Task", since status lives on the right as a proper tag instead of a text suffix. Done tasks skip the tag (redundant with the "Done Â· {time}" already on the time line).
- **Read-only state:** If a project is completed, the workspace blocks new task additions, new log additions, and goal editing. Reopening requires a non-destructive `askConfirm` and captures a reopen reason into the task log.
- **Workspace task modal:** mirrors Today's shape â€” same eyebrow + name + Schedule/Assignment tiers + inline Delete. Project field auto-locked to this workspace's project.
- **â–¶ Start** as a subtle inline button in the meta line for `not_started` tasks â€” opens the existing `askNote()` "what are you doing right now?" prompt, then transitions to `in_progress`.
- **Two-tap done confirm** on the row's checkbox (same as Today). Completing a task auto-creates a "Completed: {name}" Work log entry.
- **Work log section:** day-grouped, expandable. Add entry form + log lines (time Â· body Â· Edit). **"Latest update" Insight Pill (2026-07-27, Phase 5 close-out):** the single most recent entry (by `created_at`, computed client-side via the `mostRecentLog` getter in `project-workspace.js` â€” the DB query only orders by `entry_date`, not `created_at`, so it can't just be `logs[0]`) renders as a standalone `.insight-pill` above the day-grouped list, always visible regardless of which date group is expanded. It also still appears normally in its own day group below â€” same "highlight duplicates what's in the full list" pattern Running Now already uses against the Tasks list. Older entries stay plain `.worklog-line` rows, untinted.

### Notebook overlay
- Header icon button toggles the overlay.
- Today's entry composer + "Save" (upsert on `entry_date UNIQUE`).
- Past entries listed below with individual delete + Restore-via-view.

### Restore view (config-driven)
- Header icon button opens the overlay.
- Nine collapsed-by-default sections, each showing count: Projects, Tasks, Notebook entries, Project notes, Task logs, Checklist items, Checklist history, Sleep logs, Workout logs.
- Restore (via RPC) + "Delete forever" (hard delete, second confirmation modal).
- Config-driven via `SECTION_DEFS` â€” adding a 10th soft-deletable entity is one entry there + matching db.js methods.

### Universal time picker (Round 2 build)
- Shared Alpine `timePicker12h` component + `.tp-numeric` markup: two 2-digit numeric HH/MM inputs + AM/PM segmented control.
- `inputmode="numeric"` opens the OS number pad on mobile.
- Same at every consumer: Today task modal, workspace task modal, checklist Log popup.
- Internal `.value` is still a 24-hour "HH:MM" string; no consumer's read/write code changed.

### Streaks (Phase 2)
- `atlas_targets` rows with `kind='streak'` on the Today hero band.
- Real day count via plain calendar diff from `streak_start_date` (not 6am-shifted).
- Relapse action â†’ modal â†’ `atlas_targets_log_relapse` RPC. Grace day = keeps streak alive, flips `grace_used` true. Otherwise resets `streak_start_date` and updates `previous_best_days`. Reason always required and always logged.

### Sync + reliability
- Local-first: no. Atlas is fully online â€” every mutation is a live network call.
- Every write verified (`.select().single()` or RPC `RETURNING *`).
- Soft-delete only. `deleted_at IS NULL` filter on every read (Restore view is the exception).
- `askConfirm()` for every destructive action. Never `window.confirm()`.
- 8-second undo toast on every soft-delete.

### Live schema (migrations 001â€“013)
Every migration applied. Current tables (all `atlas_` prefix, all RLS enabled):
`atlas_projects`, `atlas_tasks`, `atlas_task_logs`, `atlas_project_notes`, `atlas_notebook_entries`, `atlas_checklist_items`, `atlas_checklist_history`, `atlas_sleep_logs`, `atlas_workout_logs` (now with `day_type`), `atlas_targets`, `atlas_streak_relapses`, plus `atlas_activity` (unused placeholder from an early migration).

---

## MOCKUP-ONLY / designed but not yet built

**None as of 2026-07-26.** Design Review Rounds 1 and 2 are both fully shipped; there is no approved mockup sitting in the wings waiting for build. The Round 2 mockup artifact ([https://claude.ai/code/artifact/6569b321-ce74-4c36-a017-d404285123a7](https://claude.ai/code/artifact/6569b321-ce74-4c36-a017-d404285123a7)) is now historical reference â€” everything in it shipped as commit `2db6348`.

---

## PLANNED but not yet mocked

Nothing in this list is on the current sprint. Each is a candidate for the next design review round when Abhishek re-opens it.

### Phase 6 â€“ Tasks & Reminders redesign + Time Picker
- **Time Picker Overhaul (Shipped as starter slice):** Numeric HH:MM inputs replaced with native `<select>` dropdowns for Hours (01-12) and Minutes (15-minute increments: 00, 15, 30, 45). The user-facing format is strictly 12h AM/PM, but it internally stores the 24h `HH:MM` string for the backend. Applied universally to the shared `timePicker12h` component across all modals.
- **Structural Hooks (Shipped as starter slice):** 
  - Priority/focus pill placeholder (`<template x-if="task.priority === 'high'">`) embedded inside the task row meta section. 
  - Inert drag-handle element beside the checkbox, styled minimally as a structural placeholder.
  - History Map tab HTML comment placeholder in the Tasks header area ("future phase only").
- **Future:** AI features, calendar logic, deep grouping behaviors, and drag-and-drop implementations are deferred to the full Phase 6 build.

### Sleep/Workout â€” AI screenshot parsing
Full sleep-side plan in [`handover-docs/SLEEP-ROADMAP.md`](handover-docs/SLEEP-ROADMAP.md). The trend roll-up chart itself shipped 2026-07-27 (inline compact trend in each Health panel â€” see "Removed 2026-07-27" note above); what's left:
1. **Screenshot parser** â€” upload ring/workout-app screenshot â†’ Vertex AI (existing `VERTEX_API_KEY_POS`) â†’ review-before-save modal. Both panels already have a non-functional "Attach screenshot (future AI)" placeholder button (`.health-attach-btn`, `disabled`, no upload logic, no schema change) marking where this wires in.
2. **Pattern-of-life insights** â€” weekly correlations (e.g. "sleep score dropped 8 pts on the four nights you logged a workout after 10pm"). Requires 30+ days of data, now available from the trend data already being collected.

### Workout day-type toggle â€” weekly pattern setter
Round 2 built the per-day toggle. A follow-up would let Abhishek set default patterns (e.g. "Sundays are always Full Rest by default"). Deferred; ships only if he asks.

### Phase 3 â€” Targets goal-cards (`count_toward_goal`)
`atlas_targets` already exists with `kind='streak'` shipping. The `count_toward_goal` kind (progress bars, cumulative counters) is the other half â€” sketched in earlier `plan.md` but not started. Awaits Abhishek's go-ahead.

### Notebook â€” floating draggable window
Currently a modal overlay. A floating draggable variant (stay open while using the rest of the app) was scoped-out for later. Deferred.


### Visual-hierarchy pass on Projects list + Notebook
Round 1 covered Today. Round 2 covered the Project workspace. A similar polish pass on the Projects list surface and the Notebook overlay was scoped-out for later. Deferred.

### AI-teacher / conversational layer
The old app has a full AI-layer plan (`handover-docs/AI-LAYER-IMPLEMENTATION-PLAN.md` in the sibling repo). Nothing equivalent has been planned for Atlas. Would be its own multi-round design review if Abhishek wants it.

---

## Open questions / decisions pending

**None active as of 2026-07-27.** Round 4 shipped cleanly; Abhishek confirmed the project lifecycle direction and token refreshes. Sleep trend placement (below) was resolved this session â€” inline in-panel, not a shared overlay.

Standing "would want an answer before starting" items â€” these are not blocking anything now, but they'd need addressing before their respective phase begins:
- **Completed project card design:** The Phase 4 card design works technically and adheres to Atlas styling, but is visually unsatisfying / washed out. This is a known, accepted pending state. It should be treated as a future project-section polish item, not as an active bug to be fixed immediately.
- **Weekly-pattern setter for workout day-types** â€” is this worth building, or does the per-day toggle cover the real use case well enough?
- **Phase 3 Targets** â€” does Abhishek still want `count_toward_goal` targets, or is the streak side (which already ships) enough for now?

---

## Recommended next sequence

**Phase 5 (Health + Insight Pills) is CLOSED as of 2026-07-27, per Abhishek's explicit sign-off.**

**Phase 6 (Tasks & Reminders redesign) was initiated by Gemini but is being handed over to Claude/Comet as of 2026-07-27.**

### Phase 6 Handover State (Gemini -> Claude/Comet)
**What went right (Kept in codebase):**
- **Time Picker Overhaul:** The numeric HH:MM time inputs were successfully replaced with a native mobile-friendly 12-hour `<select>` dropdown (01-12 hours, 15-minute minute increments, AM/PM toggle). The format displayed is `h:mm AM/PM` while mapping internally to the required `HH:MM` 24-hour storage format.
- **Project Chip Styling:** The `.trv2-project` chip in the Today Tasks rows was successfully toned down to match the calmer visual hierarchy of the app (`400` font weight, `var(--surface-1)` background, border removed).

**What went wrong (Pending fixes for Claude):**
- **Alpine Crash / Console Errors:** The codebase currently suffers from an Alpine rendering crash on the Today view. The Sleep sparkline fails to render with `Uncaught ReferenceError: seg is not defined` and `Uncaught TypeError: Cannot read properties of undefined (reading 'children')`. Gemini attempted multiple fixes around `<template x-if>` root nodes, but the issue persists in the live app.
- **Priority Pills:** Structural hooks (`<span x-show="task.priority === 'high'">`) were added, but there is no UI mechanism implemented yet for the user to actually set or change a task's priority.
- **Future-Dated Tasks UX:** Currently, tasks/reminders added with a future date do not appear in the Today list (due to existing logic in `today.js`). This requires a deeper UX overhaul (e.g., scrollable sections, a split view, or a calendar view) which was deemed out of scope for the Gemini round.

### Future Workstreams (For Claude/Comet)
1. **Fix Alpine Crash:** Resolve the `seg is not defined` and `children` parsing errors on the Today page.
2. **Tasks & Reminders Redesign:** Continue Phase 6. Implement the UI for setting priorities, adding drag handles for reordering, and designing the solution for viewing future-dated tasks (History/Calendar).
3. **AI planning:** Nothing scoped yet beyond the historical reference (`handover-docs/AI-LAYER-IMPLEMENTATION-PLAN.md`, written for the old app, not Atlas). Would need its own multi-round design review before any build starts.

Older deferred items, still valid but not the stated priority:
- Projects list visual-hierarchy pass.
- Notebook layout pass.
- Phase 3 Targets (`count_toward_goal`).
- Sleep AI stages (screenshot parsing etc.).

Nothing on this list starts without Abhishek re-opening the conversation.

---

## Hard reminders

- **Read `CLAUDE.md` before writing code.** The rules live there, and they're non-negotiable without asking.
- **Read the last 2-3 `SESSION_LOG.md` entries** at the start of your session to know what the previous agent shipped and any state that isn't in the codebase yet.
- **Append your own `SESSION_LOG.md` entry at the end** - same format. Don't skip.
- **Commit and push after every completed pass in Atlas.** Do not hand off "waiting to push" - Abhishek can't review from localhost.
- **Local dev = production DB.** Do not sign in and click around locally.
