# CLAUDE.md — Atlas

Guardrails for any Claude session editing code in `D:\Calude\POS\Atlas\`. **Full architecture, design tokens, and phased roadmap live in `plan.md` next to this file — read it first if you haven't.**

Atlas is a ground-up rebuild of the POS Task Manager, in its own folder, sharing the same Supabase project as the current app but with a new `atlas_` table prefix so nothing can touch old `pos_` data. Alpine.js + plain HTML/CSS/JS. No React, no build step. Ships to MilesWeb via GitHub Actions.

Abhishek is not technical. Talk to him in plain English. Never dump code at him for approval — describe what will change and why.

---

## Current status (2026-07-26)

**Phase 1 (Projects, Tasks, Notebook, Restore, real Auth) and Phase 2 (Checklist + streak/sleep/workout migration) are both complete and deployed live at `atlas.abhisheksikka.com`.** Full detail in `CHANGELOG.md` — read the relevant phase entry before touching any of this code, it documents confirmed bugs (not just design opinions) and why specific things are built the way they are. **`DEBUG-REPORT.md` next to this file has a full 2026-07-26 audit and a fix-status marker on every finding — read it before any change that overlaps a listed area.**

**Two follow-up passes shipped 2026-07-26:**
- **Technical trust pass** — PWA icons + favicon actually exist (were missing, manifest was 404ing), theme color aligned to the current Variant-A dark palette (`#131316`); Restore view rewritten config-driven so **every one of the 9 soft-deletable entity types** is browseable and recoverable (was only Projects + Tasks; 7 others — notebook, project notes, task logs, checklist items, checklist history, sleep, workout — were silently orphaning past the 8-second undo window, with 3 stuck project notes confirmed in the live DB before the fix); `db.js` duplicate `ProjectNotes.update` line removed; sleep and workout logs moved from `todayKey()` (6am shift) to `todayIsoDate()` (midnight) — see "Date rules" below; `SCHEMA.md` and `plan.md` folder-layout drift cleaned up. Cache bumped v13 → v14.
- **Today page visual/hierarchy polish pass** — went through the standard mockup-first design-review process (interactive Before/After artifact, approved by Abhishek before any code touched the real app). What shipped: Today H1 grows to 34px above its own date so it clearly outranks the top-nav tabs; tabs slim to 14px with the *active* tab carrying primary-color weight and the accent-blue underline carrying the emphasis; KPI numbers 26 → 40px, checklist ring 90 → 128px, KPI card min-height 210; streak "relapse" changes from a coral outline pill to a quieter coral text-link (55% opacity) so it can never be mistaken for the card's primary action; `.col-height` becomes min 380 / max 560 with the existing internal scroll — replaces the earlier fixed 468px; task-column empty state gets a calm 3-dot pulse + headline + helper (only when both upcoming and recently-completed are empty); sleep/workout no-data becomes a two-line `.nodata` stack with a real helper line about manual vs planned AI-parse; routine starts every mount fully collapsed, session-only, never persisted; mini-dot colours unified with the trend chart legend (sage / muted-faded / coral / hollow); done/skipped rows mute their Log button to 35% opacity; trend legend strengthened to 11px dots + 500-weight secondary labels; task-row `.task-time`/`.task-proj` picked up 12px muted metadata treatment. Cache bumped v14 → v15. Compass polygon filled in the header logo.

**The dashboard shape stays:**
- **Hero band**: Sobriety/Smoke-free streak cards (real day-count, relapse + one-time-grace-day mechanic, "Previous best" memory) flanking a KPI strip (Tasks today as a real fraction, Active projects as color chips, Checklist as a radial ring)
- **Tasks & Reminders (60%) | Sleep + Workout (40%)**, now on a shared `.col-height` min/max instead of a fixed height — task list still scrolls internally
- **Routine** (checklist, no tab/toggle — it's just always there, full width, below the 60/40 row) — every load starts collapsed
- **Checklist Completion trend**, 30 days, real hover data (not decorative), legend strengthened
- A hidden journal toggle (small icon next to "Today", with a real hover/focus tooltip rendered in the app's own tokens — not the browser's `title=`) instead of an always-visible notes section

**Deferred, explicitly, at Abhishek's request — do not build without picking these back up first:**
- A floating/draggable Notebook window (stay open while using the rest of the app).
- **A visual-hierarchy refinement pass on Projects and Notebook** — Today got its pass on 2026-07-26; the equivalent for the other two surfaces was scoped out on purpose and stays deferred until Abhishek reopens it.
- The AI-screenshot-parse pipeline for Sleep/Workout (upload a ring/app screenshot, Gemini via Vertex reads it, you review before it saves) — confirmed technically feasible (the Supabase project already has a working Vertex integration, `ai-teacher` edge function, using secret `VERTEX_API_KEY_POS`) and scoped as its own small isolated edge function, but not built. Sleep and Workout are manual-entry only right now — the no-data helper text on Today explicitly names this planned flow so it reads as an intentional gap, not an oversight.

**Next up:** Phase 3 (Targets/goal-cards — the `count_toward_goal` side of `atlas_targets` that streaks already share the table with) — not started, needs Abhishek's go-ahead first, same as every phase so far.

---

## The absolute rules — never violate

### Authentication (added 2026-07-25)
Atlas requires a real signed-in session — email + password via Supabase Auth. **No public sign-up screen ships in the app** — the one account is created by Abhishek directly in the Supabase dashboard, so his password never passes through Claude or chat. Session persists per-browser (Supabase's default) — sign in once per browser. Every `atlas_` table's RLS policy is `TO authenticated USING (true)` — no session, no data, full stop. There is no `profiles` table or `profile_id` column for Atlas — it's single-tenant by construction (exactly one account will ever exist), so this is deliberately simpler than the old app's `auth.uid() → profiles.id` join pattern. `auth.js` owns the session (`signIn`/`signOut`/`getSession`/`onAuthStateChange`) — nothing else touches `supabase.auth` directly.

### Date rules — split by domain (locked 2026-07-26)
Two distinct date-key rules exist in Atlas, chosen deliberately, not by accident. **Do not unify them.**
- **6am-shifted logical date (`todayKey()` from `date-utils.js`):** checklist history, streak day-count, checklist ring / trend chart / completion counts. **Only these.** The 6am rollover exists because Abhishek marks his last checklist items before sleep, sometimes 3–5am, and the habit day shouldn't roll over under him mid-routine.
- **Midnight calendar date (`todayIsoDate()` helper in `pages/today.js` and `pages/notebook.js`):** everything else — tasks, projects, work log, notebook entries, daily journal, **sleep logs, workout logs**. Sleep is a real sleep cycle across night and morning, workout is a normal dated activity, and neither should ever roll on a habit boundary. Abhishek's exact words on the split: *"The 6:00 a.m. logic exists only for checklist-style end-of-day habits that I may complete before sleeping at 3–5 a.m. Sleep and workout should not use that logic."*
- An earlier debug-report finding recommended unifying the daily journal onto the 6am date; **Abhishek explicitly rejected that** on 2026-07-26 and the finding was reversed. The debug report itself documents the rejection under finding #5. If a new feature asks "what date is today?", pick from the two above by *which domain* the feature belongs to, not by "consistency". A future session that wants to change this split should ask before doing it.

### Visual hierarchy — apply proactively (added 2026-07-26)
Abhishek's exact standing instruction, on discovering the Today Tasks & Reminders card had shipped with no clear hierarchy and a hover-only edit affordance: *"Please proactively apply visual design hierarchy, spacing, and consistency principles by default — do not wait for explicit instructions on every element's placement, size, or spacing. When building or modifying any page, treat clear hierarchy (primary vs secondary vs tertiary content), consistent spacing, and readability as default requirements, the same way functionality is a default requirement."*

This is a **default requirement** on every page and every component, not an opt-in polish pass:
- **Every page/section has a clear three-tier hierarchy**: primary (page title / row's main content), secondary (section headings / metadata like time or project), tertiary (controls, timestamps, chrome). If a layout has more than two elements sitting at visually similar weight in the *same* tier, stop and re-tier before shipping.
- **Consistent spacing** across the surface — `--pad-sm/md/lg/xl` only, no inline `padding: 13px` ad-hoc values. Section gap 24–32px, card inner 16–20px.
- **Every interactive control has a visible static indicator that it exists.** Never hover-only. Touch devices don't have hover, so a hover-only control is an invisible control on the primary device this app runs on (Abhishek's phone). If a control must be revealed on hover for calm, it *also* needs a static affordance (icon shape, cursor, focus outline visible on tab).
- **Enforced inside the design-review process** — the mockup itself applies hierarchy, spacing, and visible-control rules; those rules are not "we'll layer them on later at build time."

**When flagging a design decision back to Abhishek** — always name the tier a control lives at ("secondary metadata, right-aligned"), never just describe the visual ("a small grey label"). This makes it clear whether a change moves an element between tiers (a real hierarchy decision) or just restyles within a tier (paint-level).

### Reliability
1. **`db.js` is the only file that talks to Supabase.** Every read, every write, every soft-delete goes through it. No exceptions. `supabase-client.js` is the one place the client itself is created; `db.js` and `auth.js` both import it, neither creates its own.
2. **Every write is verified.** Use `.select().single()` on a plain insert/update. Delete/archive/restore/complete/start go through a small database function via `.rpc()` instead (see `SCHEMA.md`) — a plain JSON payload can't express `now()`, so those specific transitions can't use a raw `.update()` without inventing a client-side timestamp. Either way: confirm a real row came back before treating the UI change as committed. Roll back the optimistic UI on any error or empty return.
3. **Soft-delete only.** Delete = the table's `_soft_delete` database function, `RETURNING *`. Hard-delete exists only inside the Restore view and only after a second confirmation. **Every destructive action asks "are you sure?" first**, via `askConfirm()` (`components/confirm-dialog.js`) — never `window.confirm()`.
4. **Every read filters `deleted_at IS NULL`** by default. The Restore view is the only exception.
5. **No local-first sync engine. No background sync queue. No client-invented timestamps.** Server-defaulted `created_at` / `updated_at` only.
6. **UUIDs everywhere.** No numeric ID counters. No hand-maintained sync mappings.
7. **Destructive actions always ship with an undo toast** (8 seconds, real database write) and always end up recoverable from the Restore view. **Every soft-deletable entity must appear in the Restore view — no exceptions.** `pages/restore.js` is config-driven via `SECTION_DEFS`: adding a 10th entity later means adding one entry there plus the matching `listDeleted()`/`hardDelete()`/restore-RPC in `db.js`, never a new hardcoded section in the markup. As of 2026-07-26 the view covers all 9 entities (projects, tasks, notebook entries, project notes, task logs, checklist items, checklist history, sleep logs, workout logs); an earlier version silently covered only 2 and orphaned the other 7 past the 8-second undo window — a real, confirmed data-loss surface (3 project notes were already stuck when the audit caught it).

### Module boundaries — nothing bleeds
- `db.js` → Supabase only. Sectioned by entity. Never grows into UI.
- `auth.js` → the only owner of the **session** (`signIn`/`signOut`/`getSession`/`onSessionChange`). Nothing else touches `supabase.auth`.
- `entities/*.js` → shape + validation + transitions + shape-version. No Supabase, no UI.
- `pages/*.js` → one page's state and actions. Never imports another page. Never calls Supabase directly. Cross-page navigation is a callback passed into the page's own `x-data(...)` constructor at the point it's instantiated — **not** Alpine's `$root` magic property, which resolves to the nearest ancestor `x-data`, i.e. the page's *own* root when called from inside its own scope. Using `$root` to reach the outer app shell from inside a nested page is a real, already-hit bug (Notebook's close button silently did nothing).
- `components/*.js` → props in, DOM out. No state beyond pure UI state, no fetches, no page knowledge. `undo-toast.js`, `confirm-dialog.js`, `note-prompt.js` are singleton host components (one instance mounted once in `index.html`, a module-level listener `Set`, an exported function any page calls) — follow this same pattern for any future "one shared overlay everyone can trigger" need, don't build a second one differently.
- `tokens.css` → the only place colors, spacing, type, motion, or depth are defined. Every hex / px / font family elsewhere is a bug.
- `theme.js` → the only place that reads/writes the theme preference.

**If a change would grow one file past its one job, create a new file instead.** New page → new file in `pages/`. New component → new file in `components/`. New entity → new file in `entities/` + a numbered migration + a new section in `db.js`. Even `db.js` is organized by entity section — never a messy dump.

### Schema changes
- Every schema change is a **new numbered SQL file** in `Atlas/migrations/` (`001_init.sql`, `002_add_project_priority.sql`, …).
- **Never edit an old migration.** Always add a new one.
- Referenced tables are always created before referencing tables inside each migration.
- After any schema change: update the entity file, bump its `shape-version`, add UI where needed, run the future-changes checklist below.

### Status semantics — three distinct states, never conflated
| State | Database | Meaning |
|---|---|---|
| **completed** | `status='completed'`, `deleted_at IS NULL`, `archived_at IS NULL` | Work finished, data preserved |
| **archived** | `archived_at IS NOT NULL`, `deleted_at IS NULL` | Hidden from active views, reference-only |
| **deleted** | `deleted_at IS NOT NULL` | Soft-deleted, hidden by default, recoverable |

Completing something never archives it. Archiving something never deletes it. Each transition is its own explicit action.

---

## Design tokens — locked (do not modify without explicit approval)

### Typography
- Serif (wordmark + major Project titles ONLY): `Georgia, 'Times New Roman', serif`
- Sans (everything else): `system-ui, -apple-system, 'Segoe UI', sans-serif`
- Weights: 400, 500 originally locked. **Deviated during Phase 1**: heading-style elements (`heading-label` chips, section `h2`s, work-log date headers) now use 700 — tested through three lighter attempts (600, then explicit 400/600 contrast, then 600 + full-brightness color) that all still read as "not clearly different from body text" in real testing. 700 plus a filled tinted-chip background (not color/weight alone) is what actually worked. Body/content text stays at 400.
- **Readability floor (non-negotiable)**: body ≥ 16px, buttons/nav ≥ 15px, small labels ≥ 13–14px.
- Line height: 1.6–1.75 for body, 1.25 for tight titles.

### Spacing
- `--pad-sm` 8px · `--pad-md` 16px · `--pad-lg` 20px · `--pad-xl` 28px
- Section gap 24–32px. Card inner pad 16–20px. Touch target ≥ 44px on mobile.

### Motion
- `--dur-fast` 100ms · `--dur-base` 180ms
- `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)`
- Hover translate: `translateY(-2px)`. Tap scale: `scale(0.985)`.
- **Every transition is wrapped in `@media (prefers-reduced-motion: reduce) { transition: none; transform: none; }`.**

### Charcoal Muse (dark) — "Variant A", relifted 2026-07-25
Abhishek compared three dark palette options side-by-side in a mockup (toggleable buttons in the artifact, not a guess) and picked this one because the original values below read "muddy" next to Paper Studio, which he confirmed looks right as-is. Surfaces raised, accents brightened slightly to stay legible against the lighter base. **If asked for other dark options again, the two he rejected (a cooler "Midnight Indigo" and a warmer "Warm Graphite") aren't preserved anywhere in code — they only ever existed in the throwaway mockup file, so they'd need to be redesigned from scratch, not "restored."**
```
--surface-0        : #131316
--surface-1        : #1c1d20
--surface-1-hover  : #222327
--surface-2        : #26272b
--border           : rgba(240,240,242,0.11)
--border-hover     : rgba(240,240,242,0.20)
--top-edge         : inset 0 1px 0 rgba(255,255,255,0.05)
--shadow-card      : 0 1px 2px rgba(0,0,0,0.4), 0 6px 20px rgba(0,0,0,0.25)
--shadow-card-hover: 0 2px 4px rgba(0,0,0,0.5), 0 10px 30px rgba(0,0,0,0.35)
--text-primary     : #f1efec
--text-secondary   : #9d9b97
--text-muted       : #706e69
--accent-sage      : #86ab92
--accent-blue      : #759ad0
--accent-lilac     : #ac9fd2
--accent-coral     : #dd8170
--accent-amber     : #c9a04a   (added Phase 2 -- "Grace day used" streak meta text, the only user of amber so far)
```

### Paper Studio (light)
```
--surface-0        : #ebe8e1
--surface-1        : #f8f6f2
--surface-1-hover  : #ffffff
--surface-2        : #fdfbf7
--border           : rgba(0,0,0,0.07)
--border-hover     : rgba(0,0,0,0.12)
--top-edge         : inset 0 1px 0 rgba(255,255,255,0.6)
--shadow-card      : 0 1px 2px rgba(30,25,15,0.04), 0 6px 20px rgba(30,25,15,0.06)
--shadow-card-hover: 0 2px 4px rgba(30,25,15,0.06), 0 10px 30px rgba(30,25,15,0.10)
--text-primary     : #1a1a1c
--text-secondary   : #6c6b68
--text-muted       : #94928e
--accent-sage      : #6f8f65
--accent-blue      : #5e7fb0
--accent-lilac     : #8776a8
--accent-coral     : #b56b5d
--accent-amber     : #b89a44
```

### Depth model
Three surface levels: `--surface-0` (page) → `--surface-1` (card) → `--surface-2` (nested tile inside card). Every card gets: `--surface-1` fill, `--border` hairline, `--top-edge` inset highlight, `--shadow-card`. Nothing else invents its own depth. No glassy blur, gradient fill, 3D button, neon glow, or heavy black shadow.

### Theme switching
- `<html>` carries `data-theme="auto|light|dark"` (default `auto`).
- Auto: `@media (prefers-color-scheme: dark)` picks Charcoal Muse; otherwise Paper Studio.
- The switcher is a three-button segmented control (Auto · Light · Dark) **permanently visible in the top header** — never in Settings.
- User's manual choice persists in `localStorage`.

### Project cards — locked, refined in Phase 1
- Monogram chip (34×34 desktop, 30×30 mobile) with the project's first letter in serif on a quiet accent-tinted chip (`var(--accent-<color>-tint)`, brightens to `var(--accent-<color>-tint-hover)` on hover — **never a hardcoded `rgba(...)`**, the tint must come from the per-theme token or it looks wrong in the other theme)
- Small muted color dot (7px) next to the chip
- Project name in serif, 19px desktop / 16px mobile — the hero
- One-line **description** (not current-focus — changed in Phase 1 testing; current-focus lives in the workspace, the card shows what the project *is*) in sans, 14px, `--text-secondary`
- Meta row: status text in accent color · "Details →" / "Click to open →" cue
- Click once: expands an inline summary in place (tasks-done count, running-or-next task) — does **not** navigate. Click the already-expanded card again, or its small "Open →" link, to open the full workspace. (An earlier version jumped straight to the workspace on the first click — changed after testing feedback.)
- Optional outline icon replaces the monogram *only* when it genuinely aids recognition (rare)
- **No emoji-style decoration.** **No slim-left-color-bar as the default.** Optional cover image (`cover_image_url`) can be added per project later, never required.

### Design system classes — added Phase 1 (`heading-label`, `system-text`, `user-text`, `running-text`)
Full rationale and current CSS in `ARCHITECTURE.md`. Short version: `heading-label` is a filled tinted-accent chip for a field label (e.g. "CURRENT FOCUS") — weight/color-only treatments were tried first and didn't read clearly enough against body text in real testing, a filled chip did. A **section title** (`.workspace-section h2`) is a separate, larger, plain-bold tier — no chip — so the section heading and the field labels inside it don't collapse into one indistinguishable style. `system-text` (muted italic) marks text the app auto-wrote (e.g. "Completed: task name"); `user-text` (full-strength, normal weight) marks anything typed by hand. Reuse these four classes for any new text needing this distinction — don't invent a fifth.

### Today dashboard layout — added Phase 2 (2026-07-25), polished 2026-07-26
- **Page-title hierarchy** (2026-07-26 polish): the Today page uses a `.today-block` wrapping the `<h1>Today</h1>` above a `.today-date` line — replaces the earlier H1-plus-separate-`<p class="sub">`. `.today-block h1` = 34px serif with `letter-spacing: -.005em`. The top-nav tabs slim to 14px with the *active* tab carrying weight-600 primary text and the accent-blue underline — the underline is the accent, the text is not, so navigation stays quiet and the Today H1 clearly outranks it. Don't change the tab weighting back to accent-colored text without a discussion; the whole point of the current arrangement is that the page title reads as louder than the nav.
- **Hero band** (`.hero-band`, grid `190px 1fr 190px`): a streak card left and right of a 3-card KPI strip. Streak cards use `daysFor(streak)` (plain calendar diff from `streak_start_date`, not the 6am-shifted checklist boundary — see "Date rules") and are a tinted-gradient hero card, **no icon** — an SVG "mature" icon was tried, turned out to render as a decorative star/sparkle shape and got called out directly ("remove these stars"); the number alone (56px, bold, no icon) is what's live now. KPI cards must never be "a number in a mostly-empty card" — each one carries something else: a dot row + "next up" preview (Tasks), stacked color chips (Active projects), or a radial `<svg>` progress ring (Checklist). **Polish-pass sizing (2026-07-26)**: `.kpi-num-lg` = 40px serif with a muted 20px `.denom` span for denominators like "/17"; `.kpi-label` = 13px weight-500 secondary; `.kpi-icon` = 36px; `.kpi-card` min-height 210; the checklist ring `.kpi-ring-wrap` = 128px with a 28px inner number. Don't shrink these back without a discussion — the earlier smaller values read as "small metadata" next to the 56px streak number.
- **Streak "relapse" is a quiet secondary link, not a button** (2026-07-26 polish): `.streak-action` renders as a coral text-link at 55% opacity; hover underlines and returns to full opacity. Structurally cannot be mistaken for the card's primary action. Still coral so the "caution / harm" meaning survives. **Do not repaint as a filled or outlined pill again** — the outline-pill version was live briefly and read as competing with the streak number.
- **`.split-60-40` + `.col-height`** (2026-07-26 polish): Tasks & Reminders and the Sleep+Workout column now share `min-height: 380px; max-height: 560px` — replaces the earlier fixed `height: 468px`. The task list still `overflow-y: auto`s once max is hit (`min-height: 0` on `.task-list` inside the flex column — the classic flex-child gotcha: `flex: 1` alone doesn't let a flex child shrink below its content size enough for scroll to engage). This gives balance without dead space in either direction. **Don't reintroduce a fixed height** — that was live for a round and was the exact source of the "dead space either way" complaint the fixed height was supposed to fix.
- **Task-list empty state** (2026-07-26 polish): when both `upcomingTasks` and `recentlyCompleted` are empty, the task list renders a calm `.empty-tasks` block — three slowly-pulsing dots (`@keyframes atlas-empty-pulse`, 1.6s, respects `prefers-reduced-motion` via the global override in `tokens.css`), a headline "Nothing scheduled today", and one helper line. A busy day with completed items still keeps its evidence — the empty state is gated on *both* lists being empty, not just the pending one. Don't collapse this back to the lonely italic sentence it replaced.
- **Sleep / Workout no-data helper** (2026-07-26 polish): when there's no row for today, the vitals cards render a two-line `.nodata` stack — `.h` (primary, 14px weight-500) + `.p` (muted, 12px, names the "manual or planned AI parse" flow). The existing `.ai-note` italic line stays as very-small secondary metadata below. Don't collapse this back to a single italic sentence — the two-line version tells him what's missing *and* how it fills, which is the point.
- **Routine** (checklist) has **no Tasks/Checklist toggle** — that was tried, then explicitly reversed once Tasks got its own 60% panel ("there should not be a task toggle, just a checklist"). `checklistPage()` mounts directly, unconditionally, inside Today now. **Routine starts fully collapsed on every mount** (2026-07-26 polish) — `collapsedBlocks` initial state is `{ morning: true, afternoon: true, night: true, sleep: true }`, session-only, never persisted. A hard-refresh always opens the routine calmly closed.
- **Routine mini-dots share colour language with the trend chart legend** (2026-07-26 polish): `.cl-mini-dot.done` = sage, `.cl-mini-dot.skipped` = muted with 50% opacity, `.cl-mini-dot.missed` = coral, `.cl-mini-dot.pending` = a hollow ring (transparent bg + `border: 1px solid var(--border-hover)`). Same four states, same colours, in both the routine block headers and the trend chart at the bottom of Today. `missed` only surfaces on past dates (the trend chart) — Today's mini-dots stay done / skipped / pending because in-progress items are the correct state.
- **Log button muted on already-marked rows** (2026-07-26 polish): `.ck-row.is-done .ck-log-btn` and `.ck-row.is-skipped .ck-log-btn` drop to 35% opacity; hover restores. Keeps the button reachable but stops it from reading as an active affordance on a settled row.
- **Journal pencil tooltip** (2026-07-26 polish): the small pencil icon next to the Today H1 uses `.journal-btn > .tooltip` — a real hover/focus tooltip rendered in `--surface-2` with the app's own tokens, not the browser's `title=` attribute. Text: "Log an emotion or thought about today". Use this same pattern anywhere else an icon-button needs to name itself; don't fall back to `title=` for anything user-facing (it's slow, un-styleable, and doesn't fire on keyboard focus).
- **"Today's note"/journal** is deliberately hidden by default — a small icon-button next to the `<h1>Today</h1>` toggles `journalOpen`, which reveals an inline composer using the exact same `atlas_notebook_entries` data the header's Notebook overlay reads. A permanent always-visible note card at the bottom of the page was built first and explicitly removed ("it is not required... it should be hidden").
- **"Today" KPI/task-count scoping is a real trap** — a bug shipped and had to be fixed: `upcomingTasks` originally had zero date filtering (all not-done tasks, any date, forever) while the "recently completed" list had zero date filtering the other direction (all-time completed). The two numbers could never agree with each other. Both are now scoped consistently around `todayIsoDate()` (due today, overdue-and-pending, or undated for the pending side; actually completed today — checked via `completed_at.slice(0,10)` — for the other), and the KPI shows a real fraction (`recentlyCompleted.length / tasksTodayTotal`), not a bare count. Any future "today" concept on this page must use the same scoping, not reinvent a third definition.
- **Checklist Completion trend chart** — CSS lives in `components.css` under `.trend-*`. If touching this again: check there isn't a second, older rule set still present from a previous round shadowing the current one at a lower value (this exact thing happened — `.trend-bar { height: 70px }` from before the mockup redesign was never actually replaced when the bigger version was approved, and stayed live for a full round before anyone caught it). **Legend was strengthened 2026-07-26**: `.trend-dot` = 11px, `.trend-legend` = 22px gap + 12.5px weight-500 secondary text (was 8px dots + 12px muted). Keep at these sizes — smaller reads as decorative, not scannable.
- **Task-row meta styling** (2026-07-26 polish): `.task-row .task-time` and `.task-row .task-proj` are 12px `--text-muted` metadata (times use `font-variant-numeric: tabular-nums`). Before the polish pass they had no explicit color and inherited body text, which read as equal-weight data next to the task name.

### Streaks — relapse + grace day (added Phase 2, migration 008)
Real feature, not just a UI treatment. `atlas_targets` rows with `kind='streak'` gained `previous_best_days` and `grace_used`; a new `atlas_streak_relapses` table (`target_id, occurred_date, days, reason, was_grace`) logs every relapse. One verified RPC, `atlas_targets_log_relapse(p_id, p_current_days, p_reason, p_use_grace)`, handles both outcomes in one call: if grace is requested and hasn't been used yet on this streak, the row's `grace_used` flips true and `streak_start_date` is **untouched** (the run survives); otherwise `streak_start_date` resets to today and `previous_best_days` becomes `GREATEST(old best, current run)`. A reason is always required and always logged, win or reset. Mirrors the old Task Manager app's exact rule (checked directly against `resetStreak()`/`confirmStreakReset()` in that app's `ui/overlays.js` before building this) — grace is a once-per-streak-life forgiveness, not a recurring one.

### Sleep & Workout tracking (added Phase 2, migrations 007/009/011)
Manual entry only right now (AI-screenshot parsing is planned but not built — see "Current status"). Both tables are `entry_date UNIQUE` (one row per day, upserted via `.upsert(..., {onConflict:'entry_date'})` in `DB.Sleep.save()`/`DB.Workout.save()`, same pattern as `Checklist.setStatus`). **Sleep fields**: `duration_minutes, sleep_score, deep_minutes, rem_minutes, resting_hr, hrv, note` (+ unused `start_time, light_minutes, awake_minutes` reserved for the future AI parser). **Workout fields**: `duration_minutes, workout_type, workout_score, calories, vo2_max, note`. Both display as a `.metric-grid` (3-column label+value pairs) on Today, not a one-line summary — a one-line version shipped first and was explicitly rejected as too thin once the full field list was specified.

### Time & Dates
- **12-Hour Clock Global Rule:** The application strictly uses a 12-hour AM/PM format for all user-facing time displays and inputs, as requested by Abhishek. **Never use 24-hour time in the UI.**
- **Backend Data Contract:** The database and underlying state models MUST remain in strict 24-hour ISO format (e.g., `"14:30"`). The conversion to 12-hour format is entirely a presentation layer concern.
- **Time Inputs:** Do not use native `<input type="time">`, as browser support for forcing 12-hour display varies and usually defaults to the OS setting (often 24h in many regions). Always use the custom Alpine `timePicker12h` component, which renders explicit hour/minute/AM-PM selects while seamlessly syncing a 24-hour string to the model.
- **Time Display:** Always run backend time strings through `window.formatTime12h(timeStr)` (defined in `main.js`) or use `{ hour12: true }` in `toLocaleTimeString` before rendering them in the DOM.

### Interaction
- Hover on any meaningful surface: lift `-2px`, surface brightens to `--surface-1-hover`, border to `--border-hover`, shadow to `--shadow-card-hover`, monogram chip more saturated, "Open →" cue slides in.
- Active/selected: stronger surface tone or hairline accent underline. Never a colored glow.
- Buttons: rest / hover (`translateY(-1px)`) / active. No spinners, bouncing, confetti, color pulses.
- Mobile: tap scales `0.985`, brightens surface, briefly. "Open →" and other essential affordances are always visible — never hover-gated.
- Everything respects `prefers-reduced-motion`.

---

## Never do

- Talk to Supabase from anywhere but `db.js`.
- Skip the `.select().single()` verification on a write.
- Hard-delete a row anywhere except from the Restore view with a second confirmation.
- Read a row without filtering `deleted_at IS NULL` (unless it's the Restore view).
- Invent a `created_at` or `updated_at` in the client.
- Use a numeric ID counter.
- Edit an existing migration file.
- Hardcode a color, spacing value, font family, or motion timing anywhere outside `tokens.css`.
- Put UI code in `db.js`, or Supabase calls in a component.
- Import one page from another page.
- Have a component hold state or fetch data.
- Put the theme switcher in Settings, or hide it behind a menu.
- Ship a card with no depth (must have surface + border + top-edge + shadow).
- Ship a Project card with an emoji, a large decorative icon, or a slim-left-color-bar.
- Use body text below 16px, UI text below 15px, or labels below 13px.
- Use a transition without a `prefers-reduced-motion` fallback.
- Hover-gate essential information or actions (mobile has no hover).
- Ship rich text in v1 (deferred to optional Phase 6).
- Ship push notifications in early phases (deferred to optional Phase 5).
- Add background sync, local-first, or WebSocket subscriptions.
- Touch anything with a `pos_` prefix in Supabase (that's the old app — read-only during migration, otherwise untouched).
- Bolt new code onto an existing file that would push it past its one job — create a new file instead.
- Use `window.confirm()` or `window.prompt()` — use `askConfirm()`/`askNote()` (`components/confirm-dialog.js`/`note-prompt.js`) instead.
- Use `$root` to reach the app shell from inside a nested page's own `x-data` scope — it resolves to the page's own root, not the outer app. Pass a callback in instead.
- Load Alpine.js via a separate `<script defer src="...cdn...">` tag — it races `main.js`'s own component registration and silently breaks the whole app. Alpine is imported as a module and started manually inside `main.js`, after every `Alpine.data()` call.
- Ship a deploy-worthy change without bumping `CACHE_NAME` in `service-worker.js` — this caused real, confirmed confusion during testing (a save that worked looked "missing" because the browser was still running old cached JS).
- Hardcode an `rgba(...)` tint color in `components.css` — use the theme's `--accent-*-tint` / `-tint-hover` custom properties from `tokens.css`, or it'll be wrong in the other theme.
- Rename a CSS class in markup during a rewrite without grepping for its selector in `components.css` first — `class="cl-body"` vs. the actual rule `.cl-block-body` was a real, live, confirmed bug (checklist collapse silently did nothing) caused by exactly this during the Phase 2 dashboard rewrite.
- Leave an old rule set live for a class you're "replacing" — verify the new values actually landed by reading the CSS file, not just the markup. The Checklist Completion trend chart's bigger bars were approved in the mockup but the old small `.trend-bar { height: 70px }` from a prior round was never actually deleted, and stayed live for a full shipped round before it was caught.
- Build a "today" count/filter without an explicit date scope. `upcomingTasks`/`recentlyCompleted` originally had none at all in one direction or the other, producing two numbers that could never agree (see "Today dashboard layout" above) — a real, reported bug, not a hypothetical one.
- Put a decorative icon (emoji or otherwise) on a streak or KPI card — tried once (fire emoji, then a "mature" SVG that still read as a star/sparkle), rejected both times. The number alone, bigger and bolder, is the current locked treatment.
- Build any UI with real design-decision weight (a new dashboard section, a layout change, a new card type) directly in the app before Abhishek has seen and approved a mockup — see "Design review process" below.
- Reintroduce a fixed `height` on `.col-height` — the 60/40 columns use `min-height: 380px; max-height: 560px` on purpose (2026-07-26). The fixed 468px value was live for a round and was the exact source of the "dead space either direction" complaint it was meant to solve.
- Reset `collapsedBlocks` default to `{}` in `pages/checklist.js` — it must start `{ morning: true, afternoon: true, night: true, sleep: true }` on every mount, session-only. Never persist to localStorage. A hard-refresh must always start with a calmly closed routine.
- Add a `title="..."` attribute on an icon-button where clarity matters — use the `.tooltip` pattern from `.journal-btn` (a real hover/focus element rendered in `--surface-2`). The browser's `title` is a slow, delayed, un-styleable tooltip and it doesn't fire on keyboard focus at all.
- Repaint the streak "relapse" action back into a filled or outlined pill — the current text-link at 55% opacity is what keeps it from competing with the streak number. Coral stays (coral = caution / harm / relapse); the shape is what shifts it from primary-looking to secondary.
- Shrink `.kpi-num-lg` below 40px, `.kpi-ring-wrap` below 128px, or the ring inner number below 28px without a discussion — the polish-pass values were chosen deliberately to give the KPIs the right weight next to the 56px streak number.
- Unify sleep or workout dates with the checklist's 6am rollover, or move the daily journal onto the 6am date — see the "Date rules" section above. This split was explicitly locked on 2026-07-26 and is a canonical rule, not a bug.
- Recreate a per-entity hardcoded section in `pages/restore.js` — the page is config-driven via `SECTION_DEFS`. When a new soft-deletable entity ships, add one entry there plus the matching `listDeleted()`/`hardDelete()` in `db.js`, don't fork the markup pattern.
- Change the Today `.section-header h1` size, position, or the tab-active-styling arrangement without a discussion — the 34px H1 + date-underneath + slim active-tab-with-underline is the "where am I / what today is" cue and was explicitly polished on 2026-07-26.
- Ship a layout where interactive controls (done / delete / edit / any action) are only reachable via hover with no always-visible static indicator — hover doesn't exist on touch (Abhishek's primary device is his phone), so a hover-only control is an invisible control. The Today Tasks & Reminders row shipped this way once (edit modal opened on row click but with only a fading `.task-edit-cue` label on hover), and no `done` or `delete` action existed at all — direct feedback caught it. See "Visual hierarchy — apply proactively" above.
- Rely on hover to *reveal* the fact that an element is interactive at all. A visible affordance (button shape, icon, cursor, focus outline) must exist at rest; hover may add polish (lift, cue expand, brightness) but never carries the "this exists" signal alone.

---

## Future-changes checklist

Before any change ships, walk through these eight questions. If any answer surprises, stop and think before proceeding.

1. Does it require a schema change? → Add a numbered SQL migration. Never edit an existing one.
2. Does it touch `db.js`? → Which entity section? Any other section affected? Still verified?
3. Does it change a shared component? → List every page that consumes it. Manually test each.
4. Does it affect Today, Projects, Checklist, or Notebook? → Manually test each affected tab end-to-end (create / edit / archive / delete / restore).
5. Does it require migrating existing data? → Write and rehearse a migration script on a copy. Verify per row. Approve before commit.
6. Does it affect delete or archive behavior? → Verify the three-state semantics still hold. Restore still works. Nothing resurrects on refresh.
7. Does it introduce background processes or hidden state? → Justify or refuse. Default: refuse.
8. Can it fail safely? → What does Abhishek see when the write fails? Is the app still coherent? Is the change reversible?

The canonical copy of this checklist lives in `handover-docs/FUTURE-CHANGES-CHECKLIST.md` once Phase 0 creates that folder — keep both copies in sync.

---

## Verification — every meaningful change gets tested against these

- App loads in a real browser on both desktop and phone.
- Theme switcher switches Charcoal Muse ↔ Paper Studio cleanly; Auto follows OS setting.
- Create → soft-delete → refresh → **stays deleted** (kills the resurrection bug).
- Create → archive → confirm it hides from active views but shows in archive → restore → back to active.
- Complete a Task → confirmed `completed`, not `archived`, not `deleted`.
- Force-quit mid-write → reopen → app coherent, no half-written rows.
- Direct Supabase inspection: `deleted_at` set on soft-deleted rows, active queries never return them.
- No console errors. Every `onclick` handler bound (silent `ReferenceError` was a real bug in the old app).
- Hover a Project card → lift + brighten + "Open →". Enable OS reduce-motion → transitions collapse to instant.
- Mobile: no horizontal scroll, touch targets ≥ 44px, tap state visible, essential affordances always shown.
- Body ≥ 16px, UI ≥ 15px, labels ≥ 13–14px, readable on both themes.

---

## Working with Abhishek

- Present plans as short, jargon-free bullets before writing code.
- Ask for approval before doing anything with a blast radius (schema changes, migrations, deploys, hard deletes).
- Never claim a write succeeded until Supabase's response actually confirms it.
- When something breaks, explain what happened in plain English and what the fix is — not a stack trace.
- If a request contradicts a locked decision above (tokens, module boundaries, status semantics, reliability rules), flag the conflict explicitly rather than silently working around it.

### Design review process — established Phase 2, after a direct correction

For anything with real visual/layout weight (a new page section, a dashboard, a card redesign — not a copy tweak or a bug fix), Abhishek explicitly does **not** want code written first. What happened once: the Today dashboard got built directly in the app across a couple of rounds, and he stopped it hard — "you are making a decision and doing the things I never asked you to do... this looks like you are in a hurry." The corrected process, now standing:
1. **Research first** — read the old Task Manager app's actual code for whatever's being referenced (not a description from memory), and look at any reference screenshots/inspiration he sends.
2. **Mockup as a private Claude artifact**, built with Atlas's *real* CSS tokens (not a generic template) so it previews accurately, self-contained enough to actually interact with (real hover tooltips, real click-to-toggle, a working theme switcher) — not a static picture.
3. **Show it, take the specific feedback, rebuild the same artifact** (same URL, republish in place) — this took three rounds on the Today dashboard before approval. Don't defend a choice he's rejected; fix it and show the fix.
4. **Only once he says something like "now you can start your build"** does any of it touch the real app — and even then, write the plan (schema changes needed, files touched, verification steps) before the first line of real code.
5. After building for real, expect a live-testing round to surface bugs the mockup couldn't show (data mismatches, CSS that didn't actually get ported, real interaction gaps) — treat that as a normal part of the cycle, fix everything found in one pass, and say plainly which items were bugs vs. which were the originally-requested features.
