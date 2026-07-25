# CLAUDE.md — Atlas

Guardrails for any Claude session editing code in `D:\Calude\POS\Atlas\`. **Full architecture, design tokens, and phased roadmap live in `plan.md` next to this file — read it first if you haven't.**

Atlas is a ground-up rebuild of the POS Task Manager, in its own folder, sharing the same Supabase project as the current app but with a new `atlas_` table prefix so nothing can touch old `pos_` data. Alpine.js + plain HTML/CSS/JS. No React, no build step. Ships to MilesWeb via GitHub Actions.

Abhishek is not technical. Talk to him in plain English. Never dump code at him for approval — describe what will change and why.

---

## The absolute rules — never violate

### Authentication (added 2026-07-25)
Atlas requires a real signed-in session — email + password via Supabase Auth. **No public sign-up screen ships in the app** — the one account is created by Abhishek directly in the Supabase dashboard, so his password never passes through Claude or chat. Session persists per-browser (Supabase's default) — sign in once per browser. Every `atlas_` table's RLS policy is `TO authenticated USING (true)` — no session, no data, full stop. There is no `profiles` table or `profile_id` column for Atlas — it's single-tenant by construction (exactly one account will ever exist), so this is deliberately simpler than the old app's `auth.uid() → profiles.id` join pattern. `auth.js` owns the session (`signIn`/`signOut`/`getSession`/`onAuthStateChange`) — nothing else touches `supabase.auth` directly.

### Reliability
1. **`db.js` is the only file that talks to Supabase.** Every read, every write, every soft-delete goes through it. No exceptions.
2. **Every write is verified.** Use `.select().single()` on every insert/update/soft-delete. Confirm the returned row before treating the UI change as committed. Roll back the optimistic UI on any error or null return.
3. **Soft-delete only.** Delete = `UPDATE ... SET deleted_at = now() ... RETURNING *`. Hard-delete exists only inside the Restore view and only after a second confirmation.
4. **Every read filters `deleted_at IS NULL`** by default. The Restore view is the only exception.
5. **No local-first sync engine. No background sync queue. No client-invented timestamps.** Server-defaulted `created_at` / `updated_at` only.
6. **UUIDs everywhere.** No numeric ID counters. No hand-maintained sync mappings.
7. **Destructive actions always ship with an undo toast** (8 seconds, real database write) and always end up recoverable from the Restore view.

### Module boundaries — nothing bleeds
- `db.js` → Supabase only. Sectioned by entity. Never grows into UI.
- `auth.js` → the only owner of profile identity. Nothing else knows the profile id.
- `entities/*.js` → shape + validation + transitions + shape-version. No Supabase, no UI.
- `pages/*.js` → one page's state and actions. Never imports another page. Never calls Supabase directly.
- `components/*.js` → props in, DOM out. No state, no fetches, no page knowledge.
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
- Weights: 400, 500. Nothing heavier.
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

### Charcoal Muse (dark)
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
```

### Depth model
Three surface levels: `--surface-0` (page) → `--surface-1` (card) → `--surface-2` (nested tile inside card). Every card gets: `--surface-1` fill, `--border` hairline, `--top-edge` inset highlight, `--shadow-card`. Nothing else invents its own depth. No glassy blur, gradient fill, 3D button, neon glow, or heavy black shadow.

### Theme switching
- `<html>` carries `data-theme="auto|light|dark"` (default `auto`).
- Auto: `@media (prefers-color-scheme: dark)` picks Charcoal Muse; otherwise Paper Studio.
- The switcher is a three-button segmented control (Auto · Light · Dark) **permanently visible in the top header** — never in Settings.
- User's manual choice persists in `localStorage`.

### Project cards — locked
- Monogram chip (34×34 desktop, 30×30 mobile) with the project's first letter in serif on a quiet accent-tinted chip (`rgba(<accent>, 0.14)`, brightens to `0.28` on hover)
- Small muted color dot (7px) next to the chip
- Project name in serif, 19px desktop / 16px mobile — the hero
- One-line current focus in sans, 14px, `--text-secondary`
- Meta row: status text in accent color · task-open count · last-worked, 13px
- "Open →" cue in accent color, revealed on hover (desktop) / always visible (mobile)
- Optional outline icon replaces the monogram *only* when it genuinely aids recognition (rare)
- **No emoji-style decoration.** **No slim-left-color-bar as the default.** Optional cover image (`cover_image_url`) can be added per project later, never required.

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
