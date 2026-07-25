# Atlas Architecture

## File layout (as actually built, Phase 1)

```
Deploy/js/
  config.js            Supabase URL + anon key (safe to ship -- RLS requires auth regardless)
  supabase-client.js   the one place the Supabase client is created (imported by auth.js + db.js)
  auth.js              owns the session: signIn/signOut/getSession/onSessionChange
  db.js                the one place that reads/writes Supabase tables, sectioned by entity
  date-groups.js        tiny shared groupByDate() helper (work log + Projects-page notes)
  theme.js             reads/writes the theme preference, nothing else does
  main.js              Alpine bootstrap -- imports Alpine as a module and calls Alpine.start()
                        itself, after registering every Alpine.data(). (Loading Alpine via a
                        CDN <script defer> tag races main.js's own registration and silently
                        breaks the whole app -- confirmed the hard way in Phase 1. Don't go
                        back to a separate <script> tag for Alpine.)
  entities/*.js         shape + validation + transitions + shape-version, no Supabase, no UI
  pages/*.js             one page's state + actions, calls db.js, never imports another page
  components/*.js        props in, DOM out
    theme-switcher.js    Auto -> Dark -> Light cycling button
    login-form.js         email+password sign-in
    project-card.js       monogram chip + click-to-expand summary
    undo-toast.js          singleton toast host + showUndoToast()
    confirm-dialog.js      singleton "are you sure?" host + askConfirm() -- replaces browser confirm()
    note-prompt.js         singleton optional-note host + askNote() -- replaces browser prompt()
```

`confirm-dialog.js` and `note-prompt.js` didn't exist in the original Phase 0 plan -- they were added when testing surfaced that browser `confirm()`/`prompt()` don't match the app's calm-in-app-UI design language. Both follow the exact same singleton-listener pattern as `undo-toast.js`: a module-level `Set` of listeners, one host component mounted once in `index.html`, any page calls the exported function and gets a real value back (`askConfirm()` resolves a boolean, `askNote()` resolves a string or `null`). Use these, never `window.confirm`/`window.prompt`, anywhere new.

## Module boundaries (unchanged in spirit, auth.js's job clarified)

- `db.js` → Supabase only. Sectioned by entity. Never grows into UI.
- `auth.js` → the only owner of the **session** (not a hardcoded profile id -- Atlas uses real Supabase Auth, see "Authentication" in `CLAUDE.md`). Nothing else touches `supabase.auth`.
- `entities/*.js` → shape + validation + transitions + shape-version. No Supabase, no UI.
- `pages/*.js` → one page's state and actions. Never imports another page. Never calls Supabase directly -- always through `db.js`.
- `components/*.js` → props in, DOM out. No state beyond pure UI state (e.g. a card's own `expanded` flag), no fetches, no page knowledge.
- `tokens.css` → the only place colors, spacing, type, motion, or depth are defined. Every hex / px / font family elsewhere is a bug.
- `theme.js` → the only place that reads/writes the theme preference.

**Cross-page navigation** goes through callbacks passed into a page's `x-data` constructor at the point it's instantiated (e.g. `projectsListPage({ onOpen: (id) => openProject(id) })`), not through Alpine's `$root` magic property. `$root` resolves to the *nearest* ancestor `x-data` element, which is the page's own root when called from inside that page's own scope -- it does **not** climb to the outer `app()` shell. This caused a real, confirmed bug (Notebook's close button silently doing nothing) in Phase 1. If a nested page needs to reach the app shell, pass a callback in, don't reach for `$root`.

## Write-through verification (unchanged)
1. Send the write via `.select().single()` (or, for a delete/archive/restore/complete transition, via `.rpc()` -- see `SCHEMA.md`)
2. A real row comes back → confirmed
3. Error OR null/empty result → roll back optimistic UI, surface the error

## Design system (added Phase 1, after real testing)

Four reusable classes, defined once in `components.css`, used everywhere instead of one-off styling per screen:
- `heading-label` — a field-name label (e.g. "CURRENT FOCUS"). Filled chip: tinted accent background, accent-colored bold uppercase text. Went through several iterations before landing here -- weight alone, then weight + brightness, still didn't read as clearly different from body content next to it. A filled chip (same tinted-background pattern the project monogram already uses) was the only treatment that worked regardless of font rendering.
- `system-text` — text the app wrote for you (e.g. "Completed: task name"). Muted + italic.
- `user-text` — text you personally typed. Full-strength, normal weight, most readable.
- `running-text` — the one accent (blue) for anything "live right now" (a running task's name).

A **section title** (`<h2>` inside `.workspace-section`, e.g. "Tasks", "Work Log", or the combined "Current Focus & Next Step") is a *different, larger tier* from the `heading-label` chips for the individual fields inside that section — plain bold text, no chip, bigger. Don't collapse this back to one shared style; the two-tier distinction (section title vs. field label) was specifically requested after the single-style version tested as "everything looks the same."

Tint colors (`--accent-*-tint`, `--accent-*-tint-hover`) are defined per-theme in `tokens.css` — never hardcode an `rgba(...)` value in `components.css` for these; the dark and light themes need different underlying RGB values, and a hardcoded rgba() from one theme silently looks wrong in the other (a real bug found and fixed in Phase 1 — the original monogram-chip colors were hardcoded to dark-theme hex only).

## Depth model (unchanged)
Three surface levels: `--surface-0` (page) → `--surface-1` (card) → `--surface-2` (nested tile inside card). Cards get `--surface-1` fill, `--border` hairline, `--top-edge` inset highlight, `--shadow-card`. Nothing else invents its own depth.

## Service worker cache discipline

`service-worker.js` caches the app shell aggressively (cache-first). **Every deploy-worthy round must bump `CACHE_NAME`** — forgetting this was the direct cause of real confusion during Phase 1 testing (a database write that succeeded looked "missing" on screen because the browser was silently still running an older cached JS bundle). This mirrors an identical rule already established in the sibling Task Manager app. The service worker also calls `self.skipWaiting()` + `clients.claim()` on install/activate so a new version takes over immediately rather than waiting for every tab to close.
