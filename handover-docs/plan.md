# Atlas — POS Task Manager rebuild plan

**Status: architecture approved · design approved · ready for Phase 0.**

Atlas is the new app going forward. It replaces the internal working title "POS Task Manager v2." Use "Atlas" (or "POS Atlas" when disambiguation is needed) everywhere: folder, tables, docs, UI, icons, branding. The only place legacy names appear is when this plan intentionally references the *old* app being replaced.

---

## Context

The current Task Manager app (`D:\Calude\POS\Personal management system\`) has a recurring set of reliability problems rooted in its local-first sync engine: delete resurrection, "request sent" treated as "confirmed," hand-maintained sync mappings that silently drop new fields, hand-counted numeric IDs that collide, and client/server timestamp confusion.

Rather than patch the same architecture again, Abhishek is rebuilding from scratch in a **separate folder**, keeping the current app running and untouched. Abhishek is not technical. All decisions below are in plain English.

---

## Guiding principle: build for weekly change

**v1 does not need to be perfect. v1 needs to be safe to change every few days or weeks.**

Every design decision is measured against one test: *"If I want to add a new field / new page / new behavior in two weeks, can I do it without breaking Today, Projects, Checklist, or Notebook?"* If a decision doesn't pass that test, it doesn't go in v1.

That principle led to four cuts from earlier drafts:
- Push notifications moved out of the foundation into a **later, optional phase**
- Rich text moved out of v1 — Notebook and project notes start as **plain well-styled textareas**, upgraded later only if real use demands it
- "Whatever exists in the database gets pulled" is **replaced** by explicit entity shapes (see Entity Model)
- Completed / archived / deleted are **three distinct, non-overlapping states** (see Status Semantics)

---

## Locked decisions

- **App name**: **Atlas**. Icon: **Compass** (Open Book kept as reserve alternate). Full PWA icon set + browser favicon designed around Compass.
- **Folder**: `D:\Calude\POS\Atlas\` (sibling of the current app, does not touch it)
- **Hosting**: MilesWeb (same as current app and Abhishek's three other POS apps)
- **Backend**: existing Supabase project, **new table prefix `atlas_`** (cannot touch old `pos_` tables)
- **Frontend**: Alpine.js + plain HTML/CSS/JS. No React, no build step.
- **Theme**: **Charcoal Muse** (dark) and **Paper Studio** (light). Atlas follows the OS theme by default. A **manual Auto / Light / Dark switcher is permanently visible in the top header** — never hidden in Settings — matching the pattern of Abhishek's other POS apps. No warm-amber/gold in either mode.
- **Font policy**: serif (Georgia system stack) reserved for the Atlas wordmark and major Project titles only. Sans-serif (system-ui stack) everywhere else.
- **Readability floor (non-negotiable)**: body ≥ 16px, buttons/nav ≥ 15px, small labels ≥ 13–14px. No low-contrast text. Generous line height and spacing everywhere.
- **Card depth**: no flat cards. Every meaningful surface sits visibly raised above the page via `--surface-0/1/2` layering, a hairline top-edge highlight, hairline border, and a restrained soft shadow. Never glassy, gradient-filled, 3D-button, neon, or heavy-black-shadow.
- **Interaction**: Atlas feels alive but restrained. Every meaningful surface responds on hover (subtle lift, brighten, border shift, revealed cue where useful). Fast, ease-out, 150–200ms. Respects `prefers-reduced-motion`. Mobile translates every hover cue into a tap state and always shows essential affordances (never hover-gated).
- **Project cards** (locked): monogram chip (first letter on a quiet accent-tinted chip) + small muted color dot for identity. Project name as hero in serif. Status + current focus in sans. Optional outline icon replaces the monogram only when it genuinely helps recognition. No emoji. No slim left color bar as default. Optional cover image later, never required.
- **PWA**: installable, service worker for offline shell — from day one
- **IDs**: UUIDs everywhere. No numeric counters.
- **Timestamps**: server-side only. Client never invents timestamps.
- **Deletes**: soft delete only, via `deleted_at`. Never hard delete except from the Restore view with a second confirmation.
- **Sync**: no local-first engine, no background queue. Write-through with verification.
- **V1 scope**: Projects + Tasks. Checklist and Targets ported in v1.1 and v1.2.
- **Rich text**: NOT in v1. Plain textareas until proven necessary.
- **Push notifications**: NOT in early phases. Optional later phase.
- **Migration**: streaks (must — no-smoking, no-alcohol), checklist history (nice), target data (nice). Skip old completed tasks.
- **Primary device**: desktop-first (80%), mobile-friendly for on-the-go updates.
- **AI layer**: deferred. Separate approval, separate plan, after core is stable.

---

## App structure — three top tabs

```
[Compass · Atlas]  [Notebook]  Abhishek     [Auto|Light|Dark]  [ Today | Projects | Checklist ]
```

**Today** — landing dashboard. Header stat tiles (checklist / tasks today / active projects), project-movement summary, target cards row, upcoming tasks/reminders side column.

**Projects** — colorful card grid at top. Each project uses the monogram-chip + color-dot standard. Click a card → full **Project workspace** page: Header · Current focus · Next step · Current running task · Related tasks (add / complete / log a note on completion) · Work log (day-by-day narrative + auto-entries when tasks complete) · Future plans · Notes (plain textarea in v1).

**Checklist** — daily checklist, ported from the current app (display + edit page). 6 AM logical-day boundary. Accent-edge blocks refreshed in Atlas theme.

**Notebook** (top-nav icon, not a tab) — dated entries, one per day, plain textarea in v1 (rich text is optional Phase 6 only if plain proves insufficient).

---

## Data model (Supabase, `atlas_` prefix)

Every table gets: `id uuid pk`, `created_at`, `updated_at`, `deleted_at` (nullable), plus `archived_at` (nullable) on entities that can be archived. Timestamps default server-side. RLS enabled on every table.

- `atlas_projects` — id, name, monogram_letter, color_key, description, current_focus, next_step, future_plans, status, started_at, target_date, order_index, cover_image_url (nullable, future), archived_at
- `atlas_tasks` — id, project_id (nullable — a task can exist without a project), name, status (not_started/in_progress/done), scheduled_date, scheduled_time, notify_enabled, priority (normal/high), completed_at, completion_note, archived_at
- `atlas_task_logs` — id, project_id (nullable), task_id (nullable), entry_date, body, entry_type (narrative/task_completion)
- `atlas_project_notes` — id, project_id, body (plain text in v1)
- `atlas_notebook_entries` — id, entry_date, body (plain text in v1)
- `atlas_checklist_items` — id, name, block, icon, order_index, active, archived_at
- `atlas_checklist_history` — id, item_id, entry_date (6 AM logical day), status (done/skipped/holiday/missed), unique (item_id, entry_date)
- `atlas_targets` — id, name, kind (streak/count_toward_goal), goal_value, current_value, streak_start_date, color_key, archived_at
- `atlas_target_logs` — id, target_id, entry_date, value_delta, note (manual progress entries — never auto-computed from tasks)

`atlas_push_subscriptions` is **not created in Phase 0**. It's added in the later optional push phase.

**Every schema change is a numbered migration file** kept in `Atlas/migrations/` (`001_init.sql`, `002_...`, etc.). Never edit an old migration — always add a new one. Referenced tables always created before referencing tables inside each migration.

---

## Reliability architecture — the anti-bug core

**Single choke-point.** All database reads and writes go through `js/db.js`. No other file touches Supabase.

**Every write is verified.**
1. Show optimistic UI change immediately
2. Send the write using `.select().single()` — Supabase must return the actual row
3. Returned row matches expectation → confirmed (UI already updated)
4. Error OR null row → **roll back** UI, show a clear toast, log the failure

**Every soft-delete is verified.** `UPDATE ... SET deleted_at = now() WHERE id = ... RETURNING *` — zero rows returned = treat as failure, roll back UI. This structurally kills delete resurrection: you cannot "successfully delete" something the database didn't actually touch.

**Every read filters `deleted_at IS NULL`** by default. Restore view is the one exception.

**No local-first, no background sync, no local queue.** If offline, writes fail fast with a "reconnect" banner. Reads use last-known state until reconnect.

**No hand-maintained sync mappings.** The entity model IS the mapping.

**No client-invented timestamps.** All `created_at` / `updated_at` are server-defaulted or trigger-set.

**Destructive actions never feel risky.** Four-part pattern:
1. **Recoverable by default** — delete = soft-delete, archive = reversible, complete = doesn't destroy anything
2. **Confirmation matches severity** — tiny action = one-tap toggle; large action = clear confirmation naming what's affected
3. **Immediate visible undo** — 8-second toast, restores on tap, real database write (survives refresh)
4. **Permanent Restore view** — any soft-deleted row can be found and restored later. Hard-delete only happens from Restore, and only after a second confirmation.

---

## Module boundaries — nothing bleeds

| File / folder | Only allowed to | Not allowed to |
|---|---|---|
| `db.js` | Read/write Supabase. Organized by entity section. | Contain UI code. Know page structure. |
| `auth.js` | Own the user identity / profile id. | Anything else. |
| `entities/*.js` | Define an entity's shape (fields, defaults, validation, transitions). | Read or write Supabase. Contain UI. |
| `pages/*.js` | Own one page's state + user actions. Call db.js. | Talk to Supabase directly. Import another page. Reach into a component's internals. |
| `components/*.js` | Display given data. Props in, DOM out. | Hold state. Call db.js. Know about pages. |
| `tokens.css` | Define colors, spacing, type, motion, depth. | Nothing else. |
| Everywhere else | | Hardcode colors, spacing, or fonts. |

**No page imports another page.** Shared logic goes into `db.js`, an entity file, or a component.

**No component knows about Supabase.** Components receive plain objects + callbacks.

**No file outside `auth.js` knows the profile id.**

**No global state blob.** Each page owns its own Alpine data.

---

## Entity model — controlled flexibility

Each entity has an explicit shape in one file. Example `js/entities/project.js`:

```
fields:
  id                uuid, system
  name              text, required, user-editable
  monogram_letter   text (1 char), auto from name[0], user-overridable
  color_key         text from palette, required, user-editable
  description       text, optional, user-editable
  current_focus     text, optional, user-editable
  next_step         text, optional, user-editable
  future_plans      text, optional, user-editable
  status            enum: planned | in_progress | completed, required
  started_at        date, system-set on create
  target_date       date, optional, user-editable
  order_index       int, system-managed
  cover_image_url   text, optional, user-editable (v1.x)
  archived_at       timestamptz, nullable, system
  deleted_at        timestamptz, nullable, system
  created_at        timestamptz, system
  updated_at        timestamptz, system

transitions:
  status: planned → in_progress → completed
  archive: any → archived_at set (from any status)
  restore-from-archive: archived_at → null
  delete: any → deleted_at set
  restore-from-trash: deleted_at → null

required-on-create: name, color_key
shape-version: 1
```

Each entity file declares fields, valid status transitions, required-on-create, and a shape version number (bumped when the shape changes).

**Adding a new field later — the fixed safe recipe:**
1. Write a numbered SQL migration file (`migrations/003_add_project_priority.sql`) and apply to Supabase
2. Add the field to `entities/project.js`
3. Bump the entity's shape version
4. Add UI in the specific page(s) that need it
5. Run the future-changes checklist below

No hidden allowlist. No mapping scattered across three files.

---

## Status semantics — three distinct states

| State | Meaning | Database | Where it shows |
|---|---|---|---|
| **Completed** | Work is finished. Data preserved fully. | `status = 'completed'`, `deleted_at IS NULL`, `archived_at IS NULL` | "Completed" filter on the relevant tab |
| **Archived** | Hidden from active views, kept for reference. | `archived_at IS NOT NULL`, `deleted_at IS NULL` | "Archive" view only |
| **Deleted** | Soft-deleted, hidden by default, recoverable. | `deleted_at IS NOT NULL` | Hidden. Recoverable from Restore view. |

These are **never** conflated. A project can be completed and then archived. A project can be archived and then restored. Completing something never archives it. Archiving something never deletes it. Deleting is always a distinct action with a confirmation, always reversible.

---

## Design system — final tokens

### Typography
- **Serif family** (wordmark + Project titles only): `Georgia, 'Times New Roman', serif`
- **Sans family** (everything else): `system-ui, -apple-system, 'Segoe UI', sans-serif`
- **Weights**: 400 regular, 500 medium. Nothing heavier.
- **Sizes**: body 16px, UI/nav/buttons 15px, small labels 13–14px, Project title (workspace) 26–30px serif, monogram chip 17px serif.
- **Line height**: body 1.6–1.75, tight titles 1.25.

### Spacing rhythm
- `--pad-sm` 8px · `--pad-md` 16px · `--pad-lg` 20px · `--pad-xl` 28px
- Section gap 24–32px. Card inner pad 16–20px. Touch target minimum 44px.

### Motion tokens
- `--dur-fast` 100ms · `--dur-base` 180ms
- `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)`
- Hover translate: `translateY(-2px)`
- Tap scale (mobile): `scale(0.985)`
- **Every transition wrapped in `@media (prefers-reduced-motion: reduce) { transition: none; transform: none; }`**

### Depth model (three surface levels, both themes)
- `--surface-0` — page background
- `--surface-1` — cards, panels
- `--surface-2` — nested tiles inside cards
- `--shadow-card` — restrained soft shadow (see per-theme values below)
- Top-edge highlight: `inset 0 1px 0 rgba(…)` — makes the card feel lit from above
- Hairline border on every card

Nothing else in the codebase invents its own depth. New surfaces pick from `--surface-0/1/2` and reuse `--shadow-card`.

### Charcoal Muse (dark) — final values
```
--surface-0        : #0e0e10
--surface-1        : #17181a
--surface-1-hover  : #1d1e21
--surface-2        : #1f2023
--border           : rgba(240,240,242,0.08)
--border-hover     : rgba(240,240,242,0.16)
--top-edge         : inset 0 1px 0 rgba(255,255,255,0.04)
--shadow-card      : 0 1px 2px rgba(0,0,0,0.4), 0 6px 20px rgba(0,0,0,0.25)
--shadow-card-hover: 0 2px 4px rgba(0,0,0,0.5), 0 10px 30px rgba(0,0,0,0.35)
--text-primary     : #ebe9e6
--text-secondary   : #93918e
--text-muted       : #66645f
--accent-sage      : #7ea28a
--accent-blue      : #6a8ec4
--accent-lilac     : #a598c9
--accent-coral     : #d17565
```

### Paper Studio (light) — final values
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
```

### Theme switching mechanics
- Root loads with `data-theme="auto"`. `prefers-color-scheme` picks the matching palette.
- Manual toggle in the top header sets `data-theme="light"` or `data-theme="dark"` on `<html>` and persists to `localStorage`.
- Both palettes are defined in `tokens.css` under `[data-theme="dark"]` and `[data-theme="light"]`; the auto path uses `prefers-color-scheme` media queries mapped to the same variables.
- The switcher is a three-button segmented control (Auto · Light · Dark) with a clear active state — always visible, never hidden in Settings.

### Interaction — rest / hover / active / selected / tap
- **Hover** (desktop): card lifts `-2px`, surface brightens to `--surface-1-hover`, border shifts to `--border-hover`, shadow deepens to `--shadow-card-hover`, monogram chip becomes one shade more saturated, revealed "Open →" cue slides in from the left of the meta row. All within `--dur-base`.
- **Active/selected** (current tab, focused card, chosen filter): stronger surface tone or hairline accent underline. Never a colored glow.
- **Buttons**: rest / hover / active states with `translateY(-1px)` on hover, back to 0 on active. No spinners, bouncing, confetti, or color pulses.
- **Mobile tap**: card scales to `0.985`, monogram brightens, border shifts — same signals as desktop hover, briefly, on tap-press. The "Open →" arrow is always visible on mobile (never hover-gated).
- **Reduced motion**: transitions collapse to instant state changes with no translate/scale.

### Project card standard (locked)
- Monogram chip (34×34 desktop, 30×30 mobile) with the project's first letter in serif, on a quiet accent-tinted background (`rgba(<accent>, 0.14)`, brightening to `0.28` on hover).
- Small muted color dot (7px) beside the chip for identity.
- Project name in serif, 19px desktop / 16px mobile.
- One-line current-focus in sans-serif, 14px, `--text-secondary`.
- Meta row: status text in the project's accent color · task-open count · last-worked. 13px.
- "Open →" cue in accent color, revealed on hover (desktop) / always visible (mobile).
- Optional modern outline icon replaces the monogram *only when it genuinely helps recognition* (e.g., barbell for Fitness).
- Optional cover image later — added via `cover_image_url` field, sits above the monogram row when present, never required.

---

## Folder layout

```
D:\Calude\POS\
├── Personal management system\      ← current app (untouched, keeps running)
└── Atlas\
    ├── plan.md                      ← this document (project source of truth)
    ├── CLAUDE.md                    ← guardrails for Claude sessions in this folder
    ├── Deploy\                      ← what ships to MilesWeb
    │   ├── index.html
    │   ├── manifest.json
    │   ├── service-worker.js        (PWA offline shell only — no push in v1)
    │   ├── icon-*.png               (Compass icon set)
    │   ├── favicon.svg / .ico
    │   ├── css\
    │   │   ├── tokens.css           (single source of truth for design)
    │   │   ├── layout.css
    │   │   └── components.css
    │   └── js\
    │       ├── main.js              (Alpine bootstrap, ~30 lines max)
    │       ├── config.js            (Supabase URL + publishable key)
    │       ├── auth.js              (single owner of profile identity)
    │       ├── theme.js             (theme switcher: auto/light/dark + persistence)
    │       ├── db.js                (single Supabase choke-point, sectioned by entity)
    │       ├── entities\
    │       │   ├── project.js
    │       │   ├── task.js
    │       │   ├── task-log.js
    │       │   ├── project-note.js
    │       │   ├── notebook-entry.js
    │       │   ├── checklist-item.js
    │       │   ├── checklist-history.js
    │       │   ├── target.js
    │       │   └── target-log.js
    │       ├── pages\
    │       │   ├── today.js
    │       │   ├── projects-list.js
    │       │   ├── project-workspace.js
    │       │   ├── checklist.js
    │       │   ├── checklist-edit.js
    │       │   ├── notebook.js
    │       │   └── restore.js       (soft-deleted rows, restore + hard delete)
    │       └── components\
    │           ├── project-card.js
    │           ├── task-row.js
    │           ├── target-card.js
    │           ├── stat-tile.js
    │           ├── color-picker.js
    │           ├── theme-switcher.js
    │           └── undo-toast.js
    ├── migrations\                  (numbered SQL migrations, never edited after commit)
    │   ├── 001_init.sql
    │   └── ...
    ├── handover-docs\
    │   ├── SCHEMA.md
    │   ├── ARCHITECTURE.md
    │   └── FUTURE-CHANGES-CHECKLIST.md
    └── .github\workflows\deploy-atlas.yml
```

**Rules for growth:**
- New page → new file in `pages/`. Never bolt onto an existing page.
- New reusable UI element → new file in `components/`. Never inline.
- New entity → new file in `entities/` + a numbered migration + a new section in `db.js`.
- **No file except `db.js` may grow past its one job.** Even `db.js` is organized by entity section (Projects section, Tasks section, etc.) — never a messy dump.

---

## Phased roadmap

Each phase must be approved before the next begins. Each phase ends with a running, testable slice.

### Design proof — ✅ APPROVED
- Atlas identity: Compass icon locked (Open Book reserve), Georgia serif wordmark with letter-spacing, full PWA icon set
- Themes locked: Charcoal Muse (dark) + Paper Studio (light), OS-default with visible top-header switcher
- Project cards locked: monogram chip + color dot standard
- Card depth locked: three surface levels + restrained shadow + top-edge highlight
- Interaction locked: hover lift + brighten + reveal cue, mobile tap state, `prefers-reduced-motion` respected
- Readability floor locked: 16 / 15 / 13–14

### Phase 0 — Foundations (no user-visible screens yet)
- Draft `handover-docs/SCHEMA.md` and write `001_init.sql` — creates all `atlas_` tables (except push), RLS enabled, timestamp defaults, correct dependency order
- Create every entity file in `entities/` (fields + validation + transitions + shape-version)
- Build `db.js` write-through wrapper with verification + rollback, sectioned by entity
- Build `auth.js`
- Build `theme.js` + `components/theme-switcher.js` (Auto/Light/Dark, top-header placement)
- Alpine app skeleton, PWA manifest, service worker (offline shell only, no push)
- `tokens.css` with the final Charcoal Muse + Paper Studio values above + motion + depth + spacing tokens
- GitHub Actions deploy pipeline to the chosen Atlas URL on MilesWeb (subfolder or subdomain — decided at Phase 0 kickoff so it never touches the live current app)
- **Approval gate**: schema reviewed, entity files reviewed, empty app loads at the Atlas URL with theme switcher working, deploy pipeline confirmed

### Phase 1 — Projects + Tasks (v1, the first real usable release)
- 3-tab nav + Notebook icon + user name + theme switcher (all in top header)
- **Projects tab**: card grid using the locked monogram-chip standard, create/edit project (name, color, monogram override, description), full workspace page with all sections (header, current focus, next step, running task, related tasks with add/complete/log-note, work log, future plans, project notes as plain textarea)
- **Task model**: unified (task with optional time + optional notify toggle), attached to a project or standalone
- **Today dashboard** (partial): task/reminder side column, project-movement summary, placeholders where checklist/target tiles will slot in v1.1 and v1.2
- **Notebook** (from day one): dated entries, plain textarea
- **Restore view**: soft-deleted rows browseable, restore + hard-delete (with second confirmation)
- **Reliability**: every write verified, every delete soft + verified, three-state semantics honored, undo toast on every delete
- **Interaction**: hover lift + brighten + "Open →" cue on Project cards, mobile tap state, reduced-motion honored
- **Approval gate**: Abhishek uses it for a few days, confirms no delete resurrection, no silent failures, feels calm and coherent

### Phase 2 — Checklist + Streaks migration (v1.1)
- Port checklist **display** code and visuals from the current app (refreshed in Atlas theme, unchanged behavior)
- Port the checklist **edit/modification page** — add / edit / reorder / archive checklist items, set block (Morning/Afternoon/Night/Sleep), pick icon. Item management is essential.
- 6 AM logical-day boundary
- Slot checklist status tile into Today dashboard
- **Migrate**: no-smoking and no-alcohol streaks from `pos_targets` → `atlas_targets` (one-time script, verified per row, Abhishek approves before commit)
- Migrate available checklist history from `pos_checklist` → `atlas_checklist_history` (best-effort)
- Migrate current checklist items from `pos_checklist_config` → `atlas_checklist_items`
- **Approval gate**: streaks correct in Atlas, checklist behaves like the old one, edit page works end-to-end

### Phase 3 — Targets + Notebook polish (v1.2)
- Port target cards (unchanged visual, refreshed in Atlas theme)
- Target cards row on Today dashboard
- Manual progress logging via `atlas_target_logs`
- Migrate other target data from `pos_targets` → `atlas_targets`
- **Approval gate**: all four modules working together

### Phase 4 — Polish + retire the old app
- PWA install audit on Abhishek's phone
- Full visual polish pass, dark-mode readability audit, mobile touch-target audit (≥44px)
- **Cutover decision**: retire the old app OR keep it read-only for reference — Abhishek's call
- **Approval gate**: Atlas is Abhishek's daily driver

### Phase 5 — Optional: Push notifications
- **Only if Abhishek wants it** after living on Atlas for a while. The app works fine without it.
- Rebuild push using the current app's proven Supabase Edge Function pattern (with the "log only on real send" fix baked in from day one)
- Add `atlas_push_subscriptions` + `atlas_push_log` via a new migration
- Handled entirely inside `db.js` + one new `entities/push-subscription.js` — does not touch existing pages beyond adding a "Notify me" toggle where relevant

### Phase 6 — Optional: Rich text for Notebook and project notes
- **Only if plain textareas prove insufficient** after real use
- Small, low-risk implementation (a lightweight editor, not a heavy framework)
- Contained to the notebook + project-note components — does not spread

### Phase 7 — AI layer
- Deferred entirely. Reopens as its own planning session after Phase 4 is stable.
- Starting reference: current app's `handover-docs/AI-LAYER-IMPLEMENTATION-PLAN.md`
- Vision (Abhishek's words): "Hey AI, this task is done, here are my notes" → AI logs → AI marks task done.

---

## Migration plan (Phase 2 detail)

**Must migrate:** no-smoking and no-alcohol streaks (real achievements) from `pos_targets` → `atlas_targets`.

**Nice to migrate:** checklist history, other target data, current checklist item config.

**Skip:** old completed tasks, old projects (there weren't any real ones), old settings, old ID counters, old push subscriptions.

Migration script is a **one-time, read-only** query against `pos_*` and a **verified insert** into `atlas_*`. Abhishek runs it, inspects each row-count, and approves before it commits.

---

## Non-goals for v1

- No local-first sync engine
- No background sync queue
- No Realtime / WebSocket subscriptions
- No rich text (deferred to optional Phase 6)
- No push notifications (deferred to optional Phase 5)
- No AI features (deferred to Phase 7)
- No auto-target-progress from task completion (targets are manually logged only)
- No offline editing (fail-fast + reconnect banner is enough)
- No multi-user or shared workspaces
- No numeric ID counters
- No hard deletes outside the Restore view
- No hidden allowlists, no cross-page hidden dependencies, no god files
- No emoji-style Project icons
- No slim-left-color-bar as the default Project card treatment

---

## Future-changes checklist

**Before any future feature ships, run through these eight questions.** If any answer surprises, stop and think before proceeding.

1. **Does it require a schema change?** → Add a numbered SQL migration. Never edit an existing one.
2. **Does it touch `db.js`?** → Which entity section? Are any other sections affected? Is the write still verified?
3. **Does it change a shared component?** → List every page that consumes that component. Manually test each after the change.
4. **Does it affect Today, Projects, Checklist, or Notebook?** → Manually test each affected tab end-to-end (create / edit / archive / delete / restore).
5. **Does it require migrating existing data?** → Write and rehearse the migration script on a copy. Verify per row. Approve before commit.
6. **Does it affect delete or archive behavior?** → Verify the three-state semantics (completed vs archived vs deleted) still hold. Restore still works. Nothing resurrects on refresh.
7. **Does it introduce background processes or hidden state?** → Justify why it's needed, or refuse. Default answer is refuse.
8. **Can it fail safely?** → What does Abhishek see when the write fails? Is the app still coherent? Is the change reversible?

This checklist lives in `handover-docs/FUTURE-CHANGES-CHECKLIST.md` and is treated as part of the codebase — updated when the app grows, referenced before every merge.

---

## Verification — how we know each phase is real

Every phase ends with a **live demonstration**, not a code diff.

- App loads at the Atlas URL in a real browser (desktop and phone)
- Theme switcher switches Charcoal Muse ↔ Paper Studio cleanly; Auto follows OS setting
- Create a Project → soft-delete it → refresh → **stays deleted** (kills the resurrection bug)
- Create a Project → archive it → confirm it hides from active views but shows in archive → restore it → back to active
- Complete a Task → confirm it's `completed`, not `archived`, not `deleted` (three states stay distinct)
- Add a Task with a scheduled time + notify → confirm the notify toggle persists (even though push firing waits for Phase 5)
- Force-quit the browser mid-write → reopen → app is coherent (no half-written rows)
- Direct Supabase inspection: soft-deleted rows have `deleted_at` set, active queries never return them
- Zero UUID collisions (structurally impossible, but check anyway)
- No console errors on any page
- Every `onclick` handler is bound (silent `ReferenceError` was a real bug in the old app)
- Hover a Project card → lift + brighten + "Open →" cue visible; disable motion in OS → transitions collapse to instant
- Mobile: no horizontal scroll, all touch targets ≥ 44px, tap state visible, "Open →" always shown
- Body text at 16px+, UI at 15px+, small labels at 13–14px, all readable on both themes

---

## Ready for Phase 0

Architecture approved. Design approved. Tokens locked. Plan and CLAUDE.md written. The next session begins Phase 0.
