# PLAN.md — Atlas state of the world

**Read this at the start of every session, regardless of agent.** It tells you what's actually live vs. what's still on paper vs. what hasn't been touched yet.

Sibling docs:
- [`CLAUDE.md`](CLAUDE.md) — the rules (don't deviate; ask first)
- [`SESSION_LOG.md`](SESSION_LOG.md) — running log of every session (append before ending yours)
- [`handover-docs/CLAUDE.md`](handover-docs/CLAUDE.md) — full history + detail
- [`handover-docs/SLEEP-ROADMAP.md`](handover-docs/SLEEP-ROADMAP.md) — sleep future plan

**Last updated:** 2026-07-28 (Phase 6 truly closed: Upcoming modal polish + stays-open edit flow, thin scrollbar, lighter checkbox, service-worker stale-reload bug fixed) -- **Live at:** [atlas.abhisheksikka.com](https://atlas.abhisheksikka.com) -- **Current cache version:** `atlas-offline-shell-v40` -- **Latest migration:** `015_sleep_morning_note.sql`

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
- **Full-width band of its own (2026-07-27 Health restructure).** No longer sharing a row with Sleep/Workout — the old 60/40 split put Health inside Tasks' shadow and produced dead space beside the shorter column. Tasks now gets the full page width; Sleep + Workout moved to their own row below (see "Health row").
- **Inner scroll (2026-07-28, Phase 6):** `.task-list` now has `max-height: 480px; overflow-y: auto` -- was unbounded, a long list used to stretch the whole page. Same pattern as `.modal`/`.cl-block-body` elsewhere in this file. The Project workspace's own Tasks section overrides this inline (`max-height:none; overflow:visible`) and stays unbounded -- this only affects Today's card.
- **"View more" -> Upcoming modal (2026-07-28, Phase 6; polished same day):** Today's own filter (below) never widens to include future-dated items -- instead, a `.btn-text` "View more (N)" button opens a modal listing every future-dated task/reminder. Button lives in `.panel-head-actions`, top-right of the card header next to "+ Add task" (moved there from a separate bottom-row footer after Abhishek flagged it as consuming an extra full-width row). New `futureTasks` getter in `today.js`: a clean partition of `upcomingTasks` (strictly `scheduled_date > today`, sorted ascending), no overlap, `upcomingTasks` itself untouched. The modal reuses the exact same `.trv2-row` anatomy as Today's own list. **Stays open behind the task edit modal:** clicking a row calls the ordinary `openTaskEditModal(task)` directly (no longer a special wrapper that closed Upcoming first) -- the edit modal's overlay has a bumped `z-index: 150` so it visually stacks on top, same pattern the Restore view's hard-delete confirm already used to stack on its own overlay. Cancel/Save/Delete on the edit modal only ever touch `taskModalOpen`, never `upcomingModalOpen`, so closing it naturally reveals Upcoming again, still open, with the list already reactive to whatever changed (edited date moves/removes it from `futureTasks`, marking done via the row's own checkbox removes it since `futureTasks` filters `status !== 'done'`) -- no manual refresh needed anywhere. No new DB calls, reads from the same already-loaded `this.tasks`. This is the interim home for future-dated items until a real History/Calendar page exists (see the "PLANNED" section below) -- not a replacement for one.
- **Scrollbar + row weight polish (2026-07-28):** `.task-list`'s scroll (added the same day) now has a thin custom scrollbar (`scrollbar-width: thin` + `::-webkit-scrollbar*`, `--border-hover` thumb on a transparent track, `--text-muted` on hover) instead of the browser default, which read as a bulky bright-white bar against Atlas' calm palette. `.trv2-check` shrunk 28px -> 24px, `.trv2-row` padding `12px 12px` -> `10px 12px`, column-gap `14px` -> `12px` -- the checkbox read as oversized; kept just above the point where it'd risk feeling too small to tap on mobile. Applies everywhere `.trv2-row`/`.trv2-check` are used (Today, Upcoming modal, Project workspace) since they're shared components -- consistent with how this row anatomy has always been treated as "one shape, many consumers."
- **Priority pill + drag handle removed entirely (2026-07-28, Phase 6):** Gemini's Phase 6 starter slice had added a `<span x-show="task.priority === 'high'">` pill (hardcoded `style="display:none;"`, no CSS rule, permanently invisible -- there's no UI anywhere to ever set `priority` to `'high'`) and a `.trv2-drag-handle` grab-cursor icon (real CSS, zero drag behavior behind it) to Today's main row, Today's recently-completed row, and the Project workspace Tasks row. Both removed outright from all three locations, along with the now-dead `.trv2-drag-handle` CSS rule and each row's `grid-template-columns` reverted from 4 columns back to 3 (`auto minmax(0, 1fr) auto`). `task.priority` itself is untouched in the schema -- this only removed the dead front-end hook. Real priority UI and real drag-to-reorder are both explicitly deferred to a future phase, not built here -- per Abhishek's own stated principle: "no dead or confusing affordances, either they work or they are clearly not present."
- **Row anatomy (v2):** round done-checkbox on the left · task name + kind/project chip metadata stacked in the middle · right-aligned time column with OVERDUE tag underneath if past-due · **no delete X on the row** (delete lives inside Edit).
- **Right column now shows date + time together (2026-07-27):** was time-only (or a raw unformatted date string if no time). New shared `window.formatTaskDateTime(dateStr, timeStr)` helper in `js/main.js` (alongside `formatTime12h`, same pattern) renders `"Jul 27 · 10:00 PM"` — used identically here and in the Project workspace Tasks section, both consumers of the same `.trv2-row` markup. Left side (project chip, kind label) is unchanged — confirmed with Abhishek before building, since his own spec listed project info on both sides for dashboard rows, which would have been genuinely redundant; the resolved answer was left-only, right gets just date+time for dashboard (workspace additionally gets a status tag — see the workspace section).
- **Project chip fix:** tinted `--surface-2` background with hairline border, secondary text weight-500 (softened from 600 so it doesn't read too loudly), coloured identity dot. Reads clearly on both themes.
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
- **Health row (2026-07-27 restructure):** Sleep + Workout panels sit in their own full-width row below Tasks, not squeezed into a 40% column beside it. Plain CSS grid (`display:grid; grid-template-columns:1fr 1fr`, default `align-items:stretch`) equalizes both panel heights automatically — no scroll cage, no min/max plumbing needed. Single column under 900px. Both panels have `.nodata` two-line helper when unset (names the manual + planned-AI-parse flow).
- **CONFIRMED (2026-07-27):** Sleep carries `tint-sage`, Workout carries `tint-amber` — a faint gradient wash (`linear-gradient(180deg, var(--accent-*-tint), var(--surface-1) 38%)`, same tint-token pattern as `.kpi-card.hero`/`.streak-card.color-*`) concentrated behind the header, fading to plain `--surface-1` before the note chips/session pills. Header icon chips match (sage/amber). **Workout was originally coral, softened to amber same day** — coral read as alarm/danger since it's the app's destructive/caution accent everywhere else (Delete buttons, overdue tags); amber keeps "effort/active" energy without the danger connotation, while staying visibly distinct from Sleep's sage "rest/calm." The **Smoke-free streak** (which previously used the same coral color) was also updated to use the amber tint to match this new visual theme, leaving coral purely as a semantic warning color. Delete buttons inside the Workout panel are untouched, still coral (semantic, unrelated to this decorative wash). `.tint-coral`/`.health-panel-icon.coral` are left defined, unused but harmless. Abhishek confirmed the Health row "matches my intent and is closed for Phase 5" — do not revisit this without him reopening it.
- **Routine (checklist):** always visible below the Health row. Starts fully collapsed on every mount (session-only, never persisted). Four blocks (Morning/Afternoon/Night/Sleep) with 5 px coloured left-edge. Mini-dots share colour language with the trend chart. Log popup (name + time + note). Log button muted 35% on already-marked rows.
- **Checklist Completion trend:** 30-day stacked bar chart (sage done / amber skipped / coral missed). Legend at 11 px dots + 500-weight secondary text.

### Today page — Sleep panel (manual entry, lives in the Health row)
- One row per day in `atlas_sleep_logs`, keyed on `entry_date UNIQUE` (midnight, not 6am-shifted).
- Fields: duration_minutes, sleep_score, deep_minutes, rem_minutes, resting_hr, hrv, note, morning_note.
- Modal for logging (two-step: metrics, then morning reflection).
- **Header promoted (2026-07-27, post-Comet review):** "Sleep" 13px → 17px/700, plus a 28px lilac icon chip (`.health-panel-icon.lilac`) matching the hero KPI card language. Edit/Log button upgraded from a bare text link to a bordered pill (`.health-edit-btn`, shared class with Workout's).
- **Notes redesigned as three selector-PILL chips (2026-07-27, v4 — true two-layer depth):** "Tonight's summary" (reuses the existing `sleepSummary` getter, unchanged) / "Morning reflection" / "Context", each with a tiny icon (moon / sun / message-square) in `.health-chip-head`. The three chips sit inside a shared `.health-chip-stack` "track" (`--surface-2`, 4px padding, 12px radius) with each `.health-chip` rendered as a raised "pill" (`--surface-1` + `var(--top-edge), var(--shadow-card)`, 9px radius) — the exact same two-layer depth system as the Workout day-type toggle (`.wo-daytype-group` track / `.wo-daytype-chip[aria-pressed="true"]` pill), just with all three pills permanently "active" since they're always simultaneously relevant. Gentle `translateY(-2px)` + shadow-upgrade on hover, using the same `--dur-base`/`--ease-out` tokens every other card-hover in the app uses. An empty chip shows italic placeholder text (`.health-chip-value.inactive`) instead of disappearing. This is the third and (per Abhishek's "almost satisfied, ship it") final iteration of the sleep-notes treatment: `.sleep-card-note` colored-chip box → `.health-note` plain-divider → `.health-chip` flat card → `.health-chip` pill-depth.
- **Inline 14-day trend, sparkline with sage/coral echo (2026-07-27, v4):** bottom-anchored SVG line + soft sage gradient fill + dashed goal reference line, computed by the `sleepSparkline` getter (`js/pages/today.js`) from `sleepTrendDays`/`sleepGoalMinutes` — only real logged nights become points, a missing night is a gap in the line (never a fake flat value). Chart height 46px → 80px. The line itself is drawn as individual `<line>` segments (not one `<polyline>`) so each segment can carry its own sage/coral colour depending on whether that night was above or below the goal line (`sleepSparkline.segments[i].above`) — same at-a-glance scoring the old bar chart gave, without going back to bars. The gradient area fill stays a single soft sage wash regardless, so the colour shift reads as an accent, not a second chart. Coloring goes entirely through CSS classes (`.health-spark-line.above/.below`, `.health-spark-dot.above/.below`), never inline `var()` in SVG attributes.
- **Console-error fix (2026-07-28, Phase 6):** the per-segment coloring above used to be a `segments` array looped with `<template x-for>` *inside* the `<svg>` element -- SVG content parses in a different namespace than HTML, so a template tag there isn't a real HTML template and Alpine's directive walker can't read it, which is what threw `Uncaught ReferenceError: seg is not defined` / `Cannot read properties of undefined (reading 'children')` on Today after Gemini's Phase 6 starter slice (Gemini tried fixing this by moving `x-if` roots around; the actual namespace issue wasn't identified). Fixed by having `sleepSparkline` precompute the colored `<line>` tags as one markup string (`segmentsSvg`) and injecting it with `x-html` on a `<g>` instead -- `x-html` just sets `innerHTML`, no template-cloning involved, same safe pattern `sessionIconSvg()` already uses to inject icons into an `<svg>` on the Workout panel. Same visual result, same data, only how the markup reaches the DOM changed.
- **"Attach screenshot (future AI)" placeholder (2026-07-27):** small inline text+icon link (`.health-attach-link`) — `disabled`, no upload logic, no Supabase field.

### Today page — Workout panel (manual entry + day-type toggle, lives in the Health row)
- **Header promoted (2026-07-27, v3):** same treatment as Sleep — 17px/700 title + 28px blue icon chip. Exactly two header actions (gear for targets, `.health-edit-btn` pill for sessions) — this was already the minimal set, just visually upgraded.
- **Day-type chips (Round 2 build):** three chips at the top — Workout · Active recovery · Full rest. Selected chip gets accent-tinted background. Persists per day via `day_type` column (migration 013).
- **Content reordered (2026-07-27, v3, post-Comet review):** Day-type toggle → **Today's sessions (main focus, unmoved visual style — no colored bars, no emoji)** → "This week" targets strip (`.health-targets-strip`, demoted) → 4-week consistency. Previously targets sat above sessions; Abhishek/Comet flagged that as backwards from what actually gets looked at first.
- **Session row controls consolidated (2026-07-27, v3):** the two spaced `.btn-text` Edit/Delete links replaced with one tight icon-button group (`.wo-session-actions-v2` / `.wo-icon-btn`, pencil + trash). Same underlying `openWorkoutSessionForm()`/`deleteWorkoutSession()` calls, unchanged — `deleteWorkoutSession()`'s `askConfirm()` delete-confirm flow was not touched.
- **Session rows get the same selector-pill depth as the Sleep chips (2026-07-27, v5):** Abhishek explicitly flagged that the pill treatment landed on Sleep but not Workout — `.wo-session-stack` (new track, `--surface-2`, 4px padding, 12px radius) now wraps the session list, and `.wo-session-row` itself is the raised pill (`--surface-1` + `var(--top-edge), var(--shadow-card)`, same hover lift as the sleep chips). Each row also gets a small muted icon (`.wo-session-icon`, `--text-secondary`, NOT colour-coded per activity type) via the new `sessionIconSvg(type)` helper in `today.js` — a fixed 5-entry lookup (strength/cardio_walk/yoga_stretch/active_play/cleaning) rendered with `x-html` (safe: `type` only ever comes from the session form's fixed `<select>`, never free text). `.wo-session-actions-v2`'s own background flipped `--surface-1`→`--surface-2` so the Edit/Delete icon cluster still reads as a distinct control now that the row underneath it is `--surface-1`. Only Today's inline session list changed — the separate "Workout Sessions" modal list keeps its own unrelated `.card.panel` row style.
- **Weekly targets strip:** `--surface-2` recessed block, no border, "This week" micro-label above it.
- **Active recovery state:** calm lilac walking-dot pulse + "Active recovery day / Logged — no details to enter."
- **Full rest state:** pulsing blue moon + "Full rest day / Nothing to log. Sleep well tonight."
- **4-week consistency, redesigned as an aggregated weekly strip (2026-07-27, v3):** one larger cell per week (`.health-week-cell`, 38×38px) instead of a dot per activity-type per week — computed by the `workoutWeekAggregate` getter (`js/pages/today.js`), purely derived from the existing `workoutConsistency`/`workoutTrendWeeks` data (no new loading, no schema change). A week is 'met' only if every activity type hit its target, 'missed' only if none did, else 'partial'. Shared legend (`.health-legend`) **right-aligned on the "4-WEEK CONSISTENCY" caption line (2026-07-27, v4)**, mirroring how "Avg" sits next to "14-DAY TREND" on Sleep — saves a line of vertical space vs. the legend sitting below the cells.
- **"Attach screenshot (future AI)" placeholder:** same small inline link treatment as Sleep's.
- All animations respect `prefers-reduced-motion`.

**Removed 2026-07-27 (morning pass):** the standalone full-width "Health Trends" card that used to sit at the very bottom of Today, with its own Sleep/Workout tab toggle — both trends now live inline in their respective panel. `loadHealthTrend()` and its underlying data (`sleepTrendDays`, `workoutConsistency`, `sleepAvg7`) are unchanged; only where/how the template reads them has changed (twice, same day) — first to compact bars/dot-rows, then to the sparkline/aggregated-strip described above after a Comet visual review flagged the first pass as still not right.

**Known pre-existing bug found in passing, not yet fixed (2026-07-27):** a small region of `Deploy/css/components.css` (the `.project-card-completed`/`.running-card`/`.running-note`/`.trv2-pause-reason` rules, tagged "/* v1.2 updates */") is encoded as UTF-16 with embedded NUL bytes inside the otherwise-UTF-8 file — almost certainly means `.running-card`/`.running-note`/`.trv2-pause-reason` render unstyled in production today, since a NUL byte in a stylesheet becomes U+FFFD and breaks those selectors. `.project-card-completed` has a working duplicate defined correctly elsewhere in the file, so it's unaffected. Unrelated to Phase 5 Health — flagged as a spawned task, not fixed in this pass.

### Today page — Daily journal
- Hidden by default. Small pencil-icon button next to the H1 toggles `journalOpen`.
- Composer writes to `atlas_notebook_entries` on the midnight-calendar `entry_date` (same table Notebook overlay uses).
- **Date rule locked:** notebook + daily-journal use midnight calendar date. Checklist + streaks use the 6am rollover. See CLAUDE.md.

### Projects list page
- Grid of project cards (monogram + name + description + status + task count on click-to-expand).
- **Separation of states:** Divided into "Running Projects" and "Completed Projects" sections.
- **Completed cards visual state:** Uses `.project-card-completed` (lilac tint surface), replacing the initials with the native checkmark SVG, and featuring a clean `.system-text` "Completed" caption without any faked timestamps.
- **"+ Add note" button** (Round 2 build): opens a modal composer. Notes only render below after the first save. Persistent empty Notes card removed.
- **New Project modal (Round 2 build):** name + color + monogram + description + optional **Short-term goal + target date + Long-term goal + target date** as a labelled subsection. Create fully-formed in one step.
- **"Running: X" mini Insight Pill (2026-07-27, Phase 5 close-out; contrast fixed same day):** inside an expanded project card, if a task is `in_progress`, that line renders as `.insight-pill.insight-pill-mini` — `--accent-blue-tint-hover` background (bumped up from the base `-tint`, which was blending into the already-`--surface-2` `.card-nested` it sits in), label+body inline. Just that one line is wrapped, not the whole card. Deliberately quieter than the workspace's full Running Now band — a hint, not the main focus. `.running-text`'s old plain-blue-text treatment is superseded here but the class itself is left defined (documented shared utility, not dead code).

### Project workspace page
- **Back to Projects** button top-left.
- **Hero card:** coloured project dot + 34 px serif title + status pill on the left • description below • three summary metrics • progress bar. On the right: ⋮ overflow menu (Edit goals • Mark as completed / Reopen project • Archive project • Delete project) + goals stacked.
- **Goal cards are now Insight Pills (2026-07-27, Phase 5 close-out; contrast + sizing fixed same day):** Short-term goal (flag icon) / Long-term goal (trending-up icon), each `.insight-pill.clickable.goal` — `--surface-0` body (darker than the `--surface-1` card it sits on, in both themes — see the P3 bed-colour fix below), 17px vertical padding (was 12px), 15px/500 body text on goals specifically (`.insight-pill.goal .insight-pill-body`, one step up from the 14px shared default — "one step below the project name, not three"), icon+caption head, hover lift (`translateY(-1px)` + background steps up to `--surface-1`). Supersedes the old `.ws-goal` colored-left-edge treatment (sage/blue border, a previously "locked" decision explicitly revisited this session at Abhishek's request — see `SESSION_LOG.md`). Same `startEditHeader()` click/keyboard behavior and goal-edit modal, unchanged.
- **Goal-edit modal:** opened by clicking either goal or the ⋮ menu's "Edit goals." Both goals editable together.
- **"Running now" is now an Insight Pill (2026-07-27, Phase 5 close-out; typography fixed same day):** the `.ws-section` shell is unchanged, but its content is now a single `.insight-pill` (play-triangle icon, "Running now" caption, task name as body, `running_note` as a smaller italic note below) instead of the old `.heading-label`/`.focus-text`/`.system-text` combo (which had been sitting on the broken `.running-card` class — see the "known pre-existing bug" note above; this pass stopped using `.running-card` entirely rather than fixing it in place). Task name uses a dedicated `.insight-pill-running-name` class (16px/600 — bigger/bolder than the shared `.insight-pill-body`, since here it's the pill's sole primary line and needs to dominate the small caption above it).
- **Tasks section:** same `.trv2-row` anatomy as Today, same right-column date+time treatment (below) plus a status tag. Task pause/resume mechanics exist (clicking "Pause task" in the edit modal resets it to `not_started`). **Intentionally NOT converted to Insight Pills** — Abhishek explicitly scoped this out; the full Tasks & Reminders list is planned as its own future redesign phase.
- **Right column now shows a status tag for not-done tasks (2026-07-27):** reuses the existing `.task-edit-status` pill (from the task edit modal, not a new component) below the date/time — "Not started"/"In progress"/"Paused", `.in-progress` gets the sage-tint treatment, others stay the muted default. Moved OFF the left meta line, which used to append "· In progress"/"· Done"/"· Paused" there — that's now just plain "Task", since status lives on the right as a proper tag instead of a text suffix. Done tasks skip the tag (redundant with the "Done · {time}" already on the time line).
- **Read-only state:** If a project is completed, the workspace blocks new task additions, new log additions, and goal editing. Reopening requires a non-destructive `askConfirm` and captures a reopen reason into the task log.
- **Workspace task modal:** mirrors Today's shape — same eyebrow + name + Schedule/Assignment tiers + inline Delete. Project field auto-locked to this workspace's project.
- **▶ Start** as a subtle inline button in the meta line for `not_started` tasks — opens the existing `askNote()` "what are you doing right now?" prompt, then transitions to `in_progress`.
- **Two-tap done confirm** on the row's checkbox (same as Today). Completing a task auto-creates a "Completed: {name}" Work log entry.
- **Work log section:** day-grouped, expandable. Add entry form + log lines (time · body · Edit). **"Latest update" Insight Pill (2026-07-27, Phase 5 close-out):** the single most recent entry (by `created_at`, computed client-side via the `mostRecentLog` getter in `project-workspace.js` — the DB query only orders by `entry_date`, not `created_at`, so it can't just be `logs[0]`) renders as a standalone `.insight-pill` above the day-grouped list, always visible regardless of which date group is expanded. It also still appears normally in its own day group below — same "highlight duplicates what's in the full list" pattern Running Now already uses against the Tasks list. Older entries stay plain `.worklog-line` rows, untinted.

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
- **Service worker: navigation requests are network-first, not cache-first (2026-07-28 fix).** Confirmed live bug: a normal reload (Ctrl+R) could repeatedly land back on an old cached app shell even after a fresh deploy with a bumped `CACHE_NAME`. Root cause was two-fold — (1) `service-worker.js`'s `fetch` handler served *every* request, including the page navigation itself, cache-first with no network check at all once populated; (2) the SW registration in `main.js` had no `updateViaCache` option, so the browser's own HTTP cache could serve a stale copy of `service-worker.js` itself when checking for updates, meaning a new deploy sometimes went unnoticed. Fixed: `fetch` handler now checks `event.request.mode === 'navigate'` and goes network-first (falling back to cache, then `/index.html`, only if the network request fails — e.g. offline) for the page shell specifically; static assets (JS/CSS/images) stay cache-first as before, since those are what `CACHE_NAME` bumping is for. `navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' })` in `main.js` forces the SW's own update check to always hit the network, never the HTTP cache. **Rule for future phases: this pattern (network-first navigation, cache-first assets, `updateViaCache:'none'` on registration) is now the standard and shouldn't be reverted to pure cache-first for everything** — that's what caused the bug.

### Live schema (migrations 001–013)
Every migration applied. Current tables (all `atlas_` prefix, all RLS enabled):
`atlas_projects`, `atlas_tasks`, `atlas_task_logs`, `atlas_project_notes`, `atlas_notebook_entries`, `atlas_checklist_items`, `atlas_checklist_history`, `atlas_sleep_logs`, `atlas_workout_logs` (now with `day_type`), `atlas_targets`, `atlas_streak_relapses`, plus `atlas_activity` (unused placeholder from an early migration).

---

## MOCKUP-ONLY / designed but not yet built

**None as of 2026-07-26.** Design Review Rounds 1 and 2 are both fully shipped; there is no approved mockup sitting in the wings waiting for build. The Round 2 mockup artifact ([https://claude.ai/code/artifact/6569b321-ce74-4c36-a017-d404285123a7](https://claude.ai/code/artifact/6569b321-ce74-4c36-a017-d404285123a7)) is now historical reference — everything in it shipped as commit `2db6348`.

---

## PLANNED but not yet mocked

Nothing in this list is on the current sprint. Each is a candidate for the next design review round when Abhishek re-opens it.

### Phase 6 status (2026-07-28) -- mostly closed, two items still genuinely future
Shipped: 12h/15-min time picker (Gemini starter slice), compact two-line Today row + muted project chip (Gemini starter slice), Sleep sparkline console-error fix, Tasks-card inner scroll, the Upcoming modal for future-dated tasks/reminders, and removal of the inert priority-pill/drag-handle placeholders (see the Today Tasks & Reminders card section above for all of these). Still genuinely deferred, not started:
- **Real priority system** -- a working way to mark/filter by priority. The placeholder hook that used to sit on the task row was removed outright rather than half-built (no dead affordances) -- this needs a proper design pass before any UI gets built, not a resurrected pill.
- **Real drag-and-drop reordering** -- same story, the placeholder handle was removed, actual DnD is a distinct future feature.
- **History/Calendar page** -- a full Today / Projects / History tab with a calendar and filters is its own future phase, not part of Phase 6. The Upcoming modal (Today Tasks & Reminders card, above) is the interim way to see and manage future-dated items in the meantime -- it is not a replacement for that eventual page, just what closes the gap until Abhishek opens that phase.

### Sleep/Workout — AI screenshot parsing
Full sleep-side plan in [`handover-docs/SLEEP-ROADMAP.md`](handover-docs/SLEEP-ROADMAP.md). The trend roll-up chart itself shipped 2026-07-27 (inline compact trend in each Health panel — see "Removed 2026-07-27" note above); what's left:
1. **Screenshot parser** — upload ring/workout-app screenshot → Vertex AI (existing `VERTEX_API_KEY_POS`) → review-before-save modal. Both panels already have a non-functional "Attach screenshot (future AI)" placeholder button (`.health-attach-btn`, `disabled`, no upload logic, no schema change) marking where this wires in.
2. **Pattern-of-life insights** — weekly correlations (e.g. "sleep score dropped 8 pts on the four nights you logged a workout after 10pm"). Requires 30+ days of data, now available from the trend data already being collected.

### Workout day-type toggle — weekly pattern setter
Round 2 built the per-day toggle. A follow-up would let Abhishek set default patterns (e.g. "Sundays are always Full Rest by default"). Deferred; ships only if he asks.

### Phase 3 — Targets goal-cards (`count_toward_goal`)
`atlas_targets` already exists with `kind='streak'` shipping. The `count_toward_goal` kind (progress bars, cumulative counters) is the other half — sketched in earlier `plan.md` but not started. Awaits Abhishek's go-ahead.

### Notebook — floating draggable window
Currently a modal overlay. A floating draggable variant (stay open while using the rest of the app) was scoped-out for later. Deferred.


### Visual-hierarchy pass on Projects list + Notebook
Round 1 covered Today. Round 2 covered the Project workspace. A similar polish pass on the Projects list surface and the Notebook overlay was scoped-out for later. Deferred.

### AI-teacher / conversational layer
The old app has a full AI-layer plan (`handover-docs/AI-LAYER-IMPLEMENTATION-PLAN.md` in the sibling repo). Nothing equivalent has been planned for Atlas. Would be its own multi-round design review if Abhishek wants it.

---

## Open questions / decisions pending

**None active as of 2026-07-27.** Round 4 shipped cleanly; Abhishek confirmed the project lifecycle direction and token refreshes. Sleep trend placement (below) was resolved this session — inline in-panel, not a shared overlay.

Standing "would want an answer before starting" items — these are not blocking anything now, but they'd need addressing before their respective phase begins:
- **Completed project card design:** The Phase 4 card design works technically and adheres to Atlas styling, but is visually unsatisfying / washed out. This is a known, accepted pending state. It should be treated as a future project-section polish item, not as an active bug to be fixed immediately.
- **Weekly-pattern setter for workout day-types** — is this worth building, or does the per-day toggle cover the real use case well enough?
- **Phase 3 Targets** — does Abhishek still want `count_toward_goal` targets, or is the streak side (which already ships) enough for now?

---

## Recommended next sequence

**Phase 5 (Health + Insight Pills) is CLOSED as of 2026-07-27, per Abhishek's explicit sign-off.**

**Phase 6 (Tasks & Reminders) is substantially closed as of 2026-07-28.** Gemini shipped a starter slice (time picker, compact row, muted project chip) on 2026-07-27; Claude Code took it over and closed out the remaining items the same round: the sparkline console-crash fix, the Upcoming modal for future-dated tasks, Tasks-card inner scroll, and removal of the inert priority-pill/drag-handle hooks. See the "Phase 6 status" note under Today's Tasks & Reminders card (above) and under PLANNED (below) for the full detail on each. What's left is genuinely new work, not a fix-up of this round: a real priority system, real drag-and-drop, and the full History/Calendar page -- none of those were built this round, all three need their own design pass before any code starts.

### Next workstreams
1. **AI planning:** Nothing scoped yet beyond the historical reference (`handover-docs/AI-LAYER-IMPLEMENTATION-PLAN.md`, written for the old app, not Atlas). Would need its own multi-round design review before any build starts.
2. **Real priority system + real drag-and-drop:** design pass needed before building either -- see the Phase 6 status note for why the placeholders were removed rather than kept half-built.
3. **History/Calendar page:** its own future phase; the Upcoming modal is the interim stand-in, not a replacement.

Older deferred items, still valid but not the stated priority:
- Projects list visual-hierarchy pass.
- Notebook layout pass.
- Phase 3 Targets (`count_toward_goal`).
- Sleep AI stages (screenshot parsing etc.).
- **PLAN.md encoding corruption (found 2026-07-28, not yet fixed):** ~95 mojibake sequences throughout this file (em-dashes/curly-quotes/middle-dots corrupted into sequences like "—"/"·") -- confirmed via byte inspection to be UTF-8 text that got decoded as Windows-1252 and re-saved as UTF-8 at some point, most likely during Gemini's Phase 6 session (SESSION_LOG.md has zero instances of the same pattern, so it's isolated to this file). New content added in this session's edits uses plain ASCII punctuation (`--` instead of em-dash) specifically to avoid adding more of the same corruption on top. Needs a proper repair pass -- not attempted here, out of scope for a Phase 6 close-out.

Nothing on this list starts without Abhishek re-opening the conversation.

---

## Hard reminders

- **Read `CLAUDE.md` before writing code.** The rules live there, and they're non-negotiable without asking.
- **Read the last 2-3 `SESSION_LOG.md` entries** at the start of your session to know what the previous agent shipped and any state that isn't in the codebase yet.
- **Append your own `SESSION_LOG.md` entry at the end** - same format. Don't skip.
- **Commit and push after every completed pass in Atlas.** Do not hand off "waiting to push" - Abhishek can't review from localhost.
- **Local dev = production DB.** Do not sign in and click around locally.
