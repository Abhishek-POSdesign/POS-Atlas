# PLAN.md — Atlas state of the world

**Read this at the start of every session, regardless of agent.** It tells you what's actually live vs. what's still on paper vs. what hasn't been touched yet.

Sibling docs:
- [`CLAUDE.md`](CLAUDE.md) — the rules (don't deviate; ask first)
- [`SESSION_LOG.md`](SESSION_LOG.md) — running log of every session (append before ending yours)
- [`handover-docs/CLAUDE.md`](handover-docs/CLAUDE.md) — full history + detail
- [`handover-docs/SLEEP-ROADMAP.md`](handover-docs/SLEEP-ROADMAP.md) — sleep future plan

**Last updated:** 2026-07-29 (Atlas AI Phase 1 shipped: overlay, persona+PIN, hybrid routing, memory notebook, log-workout/log-sleep voice-write flows; header made sticky) -- **Live at:** [atlas.abhisheksikka.com](https://atlas.abhisheksikka.com) -- **Current cache version:** `atlas-offline-shell-v42` -- **Latest migration:** `016_ai_notebook.sql`

---

## LIVE IN PRODUCTION (as of 2026-07-26)

Everything below is deployed and confirmed on the live app. Anything Antigravity shipped in earlier sessions is included — detected by reading the current code + commit history.

### Authentication & shell
- Real Supabase Auth (email + password). Single-account, one profile, no signup screen — Abhishek's account is provisioned directly in the Supabase dashboard.
- Session persists per-browser (Supabase default).
- Three-state theme switcher (Auto · Light · Dark) permanently visible in top header. Charcoal Muse (dark) and Paper Studio (light) — both fully painted.
- PWA installable: manifest.json + icon-192.png + icon-512.png + favicon.svg + service-worker.js with `skipWaiting` + `clients.claim`. Cache currently `v19`.
- Header actions: Notebook overlay button, Restore overlay button, user name, theme switcher, sign-out.

### Today page — Tasks & Reminders (split into two cards, 2026-07-29)
- **Split into Active (65%) | Completed today (35%) — "Option 2" (2026-07-29).** Was one full-width card with completed items sharing the same scroll space as active ones (2026-07-27 Health restructure gave it the full row width; 2026-07-28 added inner scroll on top of that single card). Abhishek asked for two layout mockups (single card w/ collapsed completed section, vs. split cards) via an Artifact before any code changed, picked the split. `.tasks-row` is the same grid-with-gap/stretch pattern `.health-row` already uses below it, just 65fr/35fr instead of 1fr/1fr — stacks to one column under 900px, same breakpoint.
- **Left card — Active list.** Header unchanged: "Tasks & Reminders" + `.panel-head-actions` (View more, +Add task). `.task-list` max-height tightened `480px` → `260px` (~4 rows) now that completed items no longer share this space — with 1–2 tasks the list (and the card) just shrinks, no min-height anywhere in the chain. Empty state ("Nothing scheduled today") now depends only on `upcomingTasks.length === 0` — it used to also check `recentlyCompleted.length === 0`, which no longer makes sense now that completed items live in their own card.
- **Right card — "Completed today."** Reuses the existing `recentlyCompleted` getter as-is — no new query. Deliberately lighter row than `.trv2-row` (new `.mini-task-row`: 16px filled sage check, muted strikethrough name, time — no project chip, no kind label, ~34px tall vs. `.trv2-row`'s ~62px) so it reads as a glance, not a second task list. The old "Recently completed" divider + inert `.trv2-row` treatment inside the main list is gone — `.task-list-divider` CSS deleted, confirmed zero remaining usages before removing.
- **Premium empty state on the Completed card (2026-07-29).** When `recentlyCompleted.length === 0`, a custom SVG illustration (`.completed-empty-art`) replaces the mini-list instead of leaving dead space — a slightly-rotated checklist sheet (`--surface-2` fill, `--border-hover` stroke/lines) with two filled `--accent-sage` "done" dots and one hollow pending dot, plus two small sage sparkle accents, centred above a headline ("Nothing completed yet") + helper line ("Finished tasks will show up here."), styled like the rest of the app's empty states (`.h`/`.p` treatment matching `.nodata`/`.empty-tasks`). Single accent colour throughout (sage — Atlas' locked "done/positive" meaning everywhere else: KPI ring, trend charts, Health chips), no new tokens, no emoji — modeled after reference illustrations Abhishek liked the *shape* of (a filled-in checklist graphic) but recoloured entirely into Atlas' existing muted palette instead of their bright pastel originals. Only shows at zero completions; 1+ completed items always show the real mini-list, even if it's just one row (a single real row isn't "dead space" the way zero is).
- **Row anatomy (v2, shared across Today/Upcoming modal/Project workspace):** round done-checkbox (24px, shrunk from 28px on 2026-07-28) on the left · task name + kind/project chip metadata · right-aligned time column with OVERDUE tag underneath if past-due · **no delete X on the row** (delete lives inside Edit). `.trv2-row` padding `10px 12px`, column-gap `12px`.
- **Scrollbar:** `.task-list` has a thin custom scrollbar (`scrollbar-width: thin` + `::-webkit-scrollbar*`, `--border-hover` thumb on transparent track, `--text-muted` on hover) instead of the browser default — always faintly visible, not hover-only.
- **"View more" → Upcoming modal:** `.btn-text` "View more (N)" button in `.panel-head-actions`, top-right of the Active card's header next to "+ Add task." New `futureTasks` getter in `today.js`: a clean partition of `upcomingTasks` (strictly `scheduled_date > today`, sorted ascending), no overlap, `upcomingTasks` itself untouched. The modal reuses the exact same `.trv2-row` anatomy. **Stays open behind the task edit modal:** clicking a row calls `openTaskEditModal(task)` directly — the edit modal's overlay has a bumped `z-index: 150` so it visually stacks on top, same pattern the Restore view's hard-delete confirm already uses to stack on its own overlay. Cancel/Save/Delete on the edit modal only ever touch `taskModalOpen`, never `upcomingModalOpen`, so closing it naturally reveals Upcoming again, still open and already reactive to whatever changed. No new DB calls. Interim home for future-dated items until a real History/Calendar page exists (see PLANNED below) — not a replacement for one.
- **Priority pill + drag handle removed entirely (2026-07-28):** Gemini's Phase 6 starter slice had added a `<span x-show="task.priority === 'high'">` pill (hardcoded `style="display:none;"`, no CSS rule, permanently invisible — no UI anywhere ever sets `priority` to `'high'`) and a `.trv2-drag-handle` grab-cursor icon (real CSS, zero drag behavior). Removed outright from all row locations, along with the dead `.trv2-drag-handle` CSS rule; `grid-template-columns` reverted 4 columns → 3. `task.priority` itself untouched in the schema. Real priority UI and real drag-to-reorder are both deferred to a future phase, not built here — per Abhishek's own principle: "no dead or confusing affordances, either they work or they are clearly not present."
- **Right column shows date + time together:** `window.formatTaskDateTime(dateStr, timeStr)` helper in `js/main.js` (alongside `formatTime12h`) renders `"Jul 27 · 10:00 PM"` — same helper used in the Project workspace Tasks section.
- **Overdue state:** past-scheduled tasks/reminders show coral time + "OVERDUE" tag. `isOverdue()` narrowly defined (past date OR today+past time, never done).
- **Two-tap done confirm:** first tap on checkbox arms row with sage-tint + inline hint; second tap within 2.5s commits; expires silently.
- **Edit-on-click:** clicking anywhere on the row (except the checkbox) opens the task edit modal.

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

### Atlas AI — Phase 1 (shipped 2026-07-29, mockup-approved beforehand)
Full architecture plan lives in the session's approved plan doc (see SESSION_LOG.md entry below for the summary); built directly on the proven, already-shipped reference pattern from the sibling Task Manager app's "Partner" AI layer (`Personal management system/Deploy/js/features/ai.js` + `ui/aiPanel.js`), not the stale/superseded planning doc that sits next to it.
- **Floating launcher** (`.ai-launcher`, 48px, bottom-right, Atlas's own compass mark — not an invented icon) opens the panel; hides while the panel is open.
- **Docked panel, content-shifting, not an overlay** (`.ai-panel`) — no backdrop dim, no scroll lock. Docks flush against the bottom of Atlas's own header with zero gap (`--atlas-header-h` CSS var, measured at runtime in `ui/aiPanel.js`'s `init()` off `.app-header-sticky`'s real height — not a hardcoded pixel guess). `.content-area` picks up `margin-right: 370px` via a `body:has(.ai-panel-open)` CSS rule when open.
- **Header made sticky** (`.app-header-sticky` wrapping `.top-header` + `.top-tabs` in `index.html`, `position: sticky; top:0` in `layout.css`) — was a real pre-existing bug (scrolled away), fixed as part of this pass since the AI panel needed to align with it.
- **Header utility row**: context badge and "Atlas ·" prefix were both cut after mockup review (kept the header from feeling crowded) — just a bare `Local ▾`/`Cloud ▾` pill, notebook icon, settings gear, clear-chat (trash, routed through the existing `askConfirm()` singleton — not a bespoke inline bar), close.
- **Persona system**: 7 fields (Role, Job, Targets, Knowledge, About Me, Responsibilities, Strict Instructions) in `features/aiConfig.js`, compiled into one system prompt via `buildSystemPrompt()`. Stored in `localStorage` only (`atlas_ai_persona`) — no schema needed, matches Partner's own pattern.
- **PIN lock**: 6-digit numeric pad, SHA-256 hashed via Web Crypto (`atlas_ai_pin` in `localStorage`). Forgot-PIN / Change-PIN both clear only the hash — persona text and notebook are untouched.
- **Hybrid routing**: one stored `{provider, model, endpoint}` setting (`atlas_ai_config`). Local = Ollama non-streaming `/api/chat` call (manual model-name field, no CORS auto-probe). Cloud = a **new, Atlas-specific Supabase Edge Function** (`atlas-ai`, distinct from the sibling app's `pos-partner`) — **not deployed yet**, needs its own Vertex/Gemini secret provisioned before Cloud actually answers; until then it fails with a plain "unavailable" message, never a silent fallback to Local.
- **AI Memory Notebook**: new `atlas_ai_notebook` table (migration 016, single-row `entries jsonb`, RLS `authenticated`-only) + `localStorage` fast-read path, last-write-wins on `updated_at`. Pin / Save Session / Compact all implemented, each tries a real model summarization call first and falls back to a plain-text truncation if the provider is unreachable (never a hard failure).
- **Voice-write flows — two shipped**: Log workout, Log sleep. Dictation (Web Speech API, same proven pattern as Partner) → the model is asked (via a fixed extraction instruction in `features/aiContext.js`) to respond with strict JSON if it recognizes either intent → the app validates/clamps every field (`sanitizeDraftFields()`, never trusts the model's raw values) → a confirm card renders inline in the chat stream → **only Confirm calls the real write** (`DB.Workout.save()` / `DB.Sleep.save()`) → Cancel discards, nothing written either way.
- **Fact Package**: `features/aiContext.js`'s `buildFactPackage()` covers `explain_day`, `explain_task`, `explain_health`, `log_workout`, `log_sleep` — every one reads through existing `DB.*` methods only, no new queries invented. Every ordinary chat message currently carries `explain_day` as ambient context (the per-view context-badge binding was cut from this round's UI, so there's no separate "About: Project X" Fact Package variant live yet — `explain_task`/`explain_health` are reachable via the quick-action chips, which build their own package on demand).
- **What's NOT done yet**: the `atlas-ai` Edge Function itself (Cloud provider will show "unavailable" until this is deployed with a real secret); the remaining three voice-write flows (task completion, checklist marking, journal reflections) — Phase 1 deliberately shipped only the two Abhishek's own examples named, per the approved plan's phased approach; per-view Fact Package binding (badge was cut, so it's always `explain_day` right now).

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
- **Drag-to-complete (2026-07-29 ask, deferred by Abhishek's own choice, not scoped out by Claude):** drag a task row out of the Active list and onto the "Completed today" card (see the split-card layout above) to mark it done, instead of the existing checkbox tap. A **different** feature from "real drag-and-drop reordering" above -- that one is about reordering position within the same list; this one is about dragging *between* the two cards as an alternate completion gesture. Abhishek asked for a size estimate before deciding whether to build it, so the assessment is on record: **desktop mouse-only is a small-medium build** (a few hours -- native HTML5 drag events, no new library, reuses the existing `completeTaskOnToday()` completion call). **Working properly on his phone -- the primary device this app runs on -- is medium-large**, because native HTML5 drag-and-drop has no touch support at all in mobile browsers; a real implementation needs a custom touch-gesture system (long-press-to-initiate is the usual mobile pattern) that can tell "the user is scrolling the task list" apart from "the user is dragging this row out of it," which is the genuinely hard part, not the completion logic itself. Not started. Would need its own quick mockup/interaction spec before building, same as any other real-design-weight change.

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

### AI layer -- Phase 1 shipped 2026-07-29 (see LIVE section above); fast-follow work
Not started yet, deliberately deferred per the approved plan:
- The `atlas-ai` Supabase Edge Function itself (Cloud provider needs this + a real Vertex/Gemini secret before it stops showing "unavailable").
- The remaining three voice-write flows: task completion, checklist marking, journal reflections.
- Per-view Fact Package binding (a context badge showing "About: Project X" etc. -- cut from the Phase 1 UI to de-clutter the header; every message currently carries `explain_day` as ambient context regardless of which page the panel was opened from).
- Chapter 21 Stage 2+ (Vertex Teacher Mode, Logic Card versioning, Learning Records, Evaluation Packs) -- not attempted anywhere yet, including the sibling app; a distinct future initiative, not a Phase 1 gap.

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

**Atlas AI Phase 1 shipped 2026-07-29** (overlay, persona+PIN, hybrid routing, memory notebook, log-workout/log-sleep voice-write flows). See the "AI layer" section above for what's deliberately still open.

### Next workstreams
1. **Atlas AI fast-follow:** deploy the `atlas-ai` Edge Function (needs a real Vertex/Gemini secret), then the remaining three voice-write flows once the first two are live-tested.
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
