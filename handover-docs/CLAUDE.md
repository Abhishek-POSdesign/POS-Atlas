# CLAUDE.md — Atlas

Guardrails for any Claude session editing code in `D:\Calude\POS\Atlas\`. **Full architecture, design tokens, and phased roadmap live in `plan.md` next to this file — read it first if you haven't.**

Atlas is a ground-up rebuild of the POS Task Manager, in its own folder, sharing the same Supabase project as the current app but with a new `atlas_` table prefix so nothing can touch old `pos_` data. Alpine.js + plain HTML/CSS/JS. No React, no build step. Ships to MilesWeb via GitHub Actions.

Abhishek is not technical. Talk to him in plain English. Never dump code at him for approval — describe what will change and why.

---

## Current status (2026-07-25)

**Phase 1 (Projects, Tasks, Notebook, Restore, real Auth) and Phase 2 (Checklist + streak/sleep/workout migration) are both complete and deployed live at `atlas.abhisheksikka.com`.** Full detail in `CHANGELOG.md` — read the relevant phase entry before touching any of this code, it documents confirmed bugs (not just design opinions) and why specific things are built the way they are.

**The Today dashboard was rebuilt from three stat tiles into a real dashboard**, ahead of where the original roadmap had it — this happened because Abhishek pushed back hard mid-Phase-2 on the checklist-page-as-its-own-tab direction ("just four checklist items, why a whole page") and asked for a proper design pass instead. That review went through **three mockup rounds** (built as private Claude artifacts, iterated on his direct feedback, never touched the real app until he said "now you can start your build") before any code was written — see "Design review process" below. What shipped:
- **Hero band**: Sobriety/Smoke-free streak cards (real day-count, relapse + one-time-grace-day mechanic, "Previous best" memory) flanking a KPI strip (Tasks today as a real fraction, Active projects as color chips, Checklist as a radial ring)
- **Tasks & Reminders (60%) | Sleep + Workout (40%)**, pinned to equal height so neither side ever leaves dead space — the task list scrolls internally instead
- **Routine** (checklist, no tab/toggle — it's just always there, full width, below the 60/40 row)
- **Checklist Completion trend**, 30 days, real hover data (not decorative)
- A hidden journal toggle (small icon next to "Today", not a permanent card) instead of an always-visible notes section

**Deferred, explicitly, at Abhishek's request — do not build without picking these back up first:**
- A floating/draggable Notebook window (stay open while using the rest of the app).
- A further visual-hierarchy refinement pass on the Phase-1-era heading-chip treatment — separate from the dashboard work above, still not revisited.
- The AI-screenshot-parse pipeline for Sleep/Workout (upload a ring/app screenshot, Gemini via Vertex reads it, you review before it saves) — confirmed technically feasible (the Supabase project already has a working Vertex integration, `ai-teacher` edge function, using secret `VERTEX_API_KEY_POS`) and scoped as its own small isolated edge function, but not built. Sleep and Workout are manual-entry only right now.

**Next up:** Phase 3 (Targets/goal-cards — the `count_toward_goal` side of `atlas_targets` that streaks already share the table with) — not started, needs Abhishek's go-ahead first, same as every phase so far.

---

## The absolute rules — never violate

### Authentication (added 2026-07-25)
Atlas requires a real signed-in session — email + password via Supabase Auth. **No public sign-up screen ships in the app** — the one account is created by Abhishek directly in the Supabase dashboard, so his password never passes through Claude or chat. Session persists per-browser (Supabase's default) — sign in once per browser. Every `atlas_` table's RLS policy is `TO authenticated USING (true)` — no session, no data, full stop. There is no `profiles` table or `profile_id` column for Atlas — it's single-tenant by construction (exactly one account will ever exist), so this is deliberately simpler than the old app's `auth.uid() → profiles.id` join pattern. `auth.js` owns the session (`signIn`/`signOut`/`getSession`/`onAuthStateChange`) — nothing else touches `supabase.auth` directly.

### Reliability
1. **`db.js` is the only file that talks to Supabase.** Every read, every write, every soft-delete goes through it. No exceptions. `supabase-client.js` is the one place the client itself is created; `db.js` and `auth.js` both import it, neither creates its own.
2. **Every write is verified.** Use `.select().single()` on a plain insert/update. Delete/archive/restore/complete/start go through a small database function via `.rpc()` instead (see `SCHEMA.md`) — a plain JSON payload can't express `now()`, so those specific transitions can't use a raw `.update()` without inventing a client-side timestamp. Either way: confirm a real row came back before treating the UI change as committed. Roll back the optimistic UI on any error or empty return.
3. **Soft-delete only.** Delete = the table's `_soft_delete` database function, `RETURNING *`. Hard-delete exists only inside the Restore view and only after a second confirmation. **Every destructive action asks "are you sure?" first**, via `askConfirm()` (`components/confirm-dialog.js`) — never `window.confirm()`.
4. **Every read filters `deleted_at IS NULL`** by default. The Restore view is the only exception.
5. **No local-first sync engine. No background sync queue. No client-invented timestamps.** Server-defaulted `created_at` / `updated_at` only.
6. **UUIDs everywhere.** No numeric ID counters. No hand-maintained sync mappings.
7. **Destructive actions always ship with an undo toast** (8 seconds, real database write) and always end up recoverable from the Restore view.

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

### Today dashboard layout — added Phase 2 (2026-07-25)
- **Hero band** (`.hero-band`, grid `190px 1fr 190px`): a streak card left and right of a 3-card KPI strip. Streak cards use `daysFor(streak)` (plain calendar diff from `streak_start_date`, not the 6am-shifted checklist boundary) and are a tinted-gradient hero card, **no icon** — an SVG "mature" icon was tried, turned out to render as a decorative star/sparkle shape and got called out directly ("remove these stars"); the number alone (56px, bold, no icon) is what's live now. KPI cards must never be "a number in a mostly-empty card" — each one carries something else: a dot row + "next up" preview (Tasks), stacked color chips (Active projects), or a radial `<svg>` progress ring (Checklist).
- **`.split-60-40` + `.col-height`**: Tasks & Reminders and the Sleep+Workout column are pinned to the *same* explicit height (currently `468px`), not left to their natural content height. This is the fix for a real, explicitly-flagged complaint ("if I have fewer tasks there's dead space, if I have more there's dead space behind the chart") — the task list gets `overflow-y: auto` with `min-height: 0` (the classic flex-child gotcha: `flex: 1` alone does **not** let a flex child shrink below its content size enough for `overflow-y: auto` to engage inside a fixed-height parent). If either side's content changes shape later, keep both sides pinned to one shared height rather than reintroducing independent natural heights.
- **Routine** (checklist) has **no Tasks/Checklist toggle** — that was tried, then explicitly reversed once Tasks got its own 60% panel ("there should not be a task toggle, just a checklist"). `checklistPage()` mounts directly, unconditionally, inside Today now.
- **"Today's note"/journal** is deliberately hidden by default — a small icon-button next to the `<h1>Today</h1>` toggles `journalOpen`, which reveals an inline composer using the exact same `atlas_notebook_entries` data the header's Notebook overlay reads. A permanent always-visible note card at the bottom of the page was built first and explicitly removed ("it is not required... it should be hidden").
- **"Today" KPI/task-count scoping is a real trap** — a bug shipped and had to be fixed: `upcomingTasks` originally had zero date filtering (all not-done tasks, any date, forever) while the "recently completed" list had zero date filtering the other direction (all-time completed). The two numbers could never agree with each other. Both are now scoped consistently around `todayIsoDate()` (due today, overdue-and-pending, or undated for the pending side; actually completed today — checked via `completed_at.slice(0,10)` — for the other), and the KPI shows a real fraction (`recentlyCompleted.length / tasksTodayTotal`), not a bare count. Any future "today" concept on this page must use the same scoping, not reinvent a third definition.
- **Checklist Completion trend chart** — CSS lives in `components.css` under `.trend-*`. If touching this again: check there isn't a second, older rule set still present from a previous round shadowing the current one at a lower value (this exact thing happened — `.trend-bar { height: 70px }` from before the mockup redesign was never actually replaced when the bigger version was approved, and stayed live for a full round before anyone caught it).

### Streaks — relapse + grace day (added Phase 2, migration 008)
Real feature, not just a UI treatment. `atlas_targets` rows with `kind='streak'` gained `previous_best_days` and `grace_used`; a new `atlas_streak_relapses` table (`target_id, occurred_date, days, reason, was_grace`) logs every relapse. One verified RPC, `atlas_targets_log_relapse(p_id, p_current_days, p_reason, p_use_grace)`, handles both outcomes in one call: if grace is requested and hasn't been used yet on this streak, the row's `grace_used` flips true and `streak_start_date` is **untouched** (the run survives); otherwise `streak_start_date` resets to today and `previous_best_days` becomes `GREATEST(old best, current run)`. A reason is always required and always logged, win or reset. Mirrors the old Task Manager app's exact rule (checked directly against `resetStreak()`/`confirmStreakReset()` in that app's `ui/overlays.js` before building this) — grace is a once-per-streak-life forgiveness, not a recurring one.

### Sleep & Workout tracking (added Phase 2, migrations 007/009/011)
Manual entry only right now (AI-screenshot parsing is planned but not built — see "Current status"). Both tables are `entry_date UNIQUE` (one row per day, upserted via `.upsert(..., {onConflict:'entry_date'})` in `DB.Sleep.save()`/`DB.Workout.save()`, same pattern as `Checklist.setStatus`). **Sleep fields**: `duration_minutes, sleep_score, deep_minutes, rem_minutes, resting_hr, hrv, note` (+ unused `start_time, light_minutes, awake_minutes` reserved for the future AI parser). **Workout fields**: `duration_minutes, workout_type, workout_score, calories, vo2_max, note`. Both display as a `.metric-grid` (3-column label+value pairs) on Today, not a one-line summary — a one-line version shipped first and was explicitly rejected as too thin once the full field list was specified.

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
