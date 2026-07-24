# Atlas Architecture

## Module Boundaries

- `db.js` → Supabase only. Sectioned by entity. Never grows into UI.
- `auth.js` → the only owner of profile identity. Nothing else knows the profile id.
- `entities/*.js` → shape + validation + transitions + shape-version. No Supabase, no UI.
- `pages/*.js` → one page's state and actions. Never imports another page. Never calls Supabase directly.
- `components/*.js` → props in, DOM out. No state, no fetches, no page knowledge.
- `tokens.css` → the only place colors, spacing, type, motion, or depth are defined. Every hex / px / font family elsewhere is a bug.
- `theme.js` → the only place that reads/writes the theme preference.

## Write-Through Verification
1. Show optimistic UI change immediately
2. Send the write using `.select().single()`
3. Returned row matches expectation → confirmed
4. Error OR null row → roll back UI, show a clear toast, log the failure

## Depth Model
Three surface levels:
- `--surface-0` (page)
- `--surface-1` (card)
- `--surface-2` (nested tile inside card)

Cards get `--surface-1` fill, `--border` hairline, `--top-edge` inset highlight, and `--shadow-card`. Nothing else invents its own depth.
