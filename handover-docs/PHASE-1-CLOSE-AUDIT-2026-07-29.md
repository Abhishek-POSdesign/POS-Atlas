# Atlas — Phase 1 Close Audit (2026-07-29)

Requested by Abhishek before closing Phase 1 and starting a one-week real-data testing phase. Scope: a full pass across the app, especially the AI layer, triaged into **Urgent**, **Non-urgent problem**, and **Phase 2**. Produced by three parallel read-only research passes (AI layer, core pages/reliability, deploy/infra hygiene) against the codebase as of commit `ebc140a`, then synthesized here. No code was changed as part of the audit itself.

---

## Urgent — fix before or during the testing week

### 1. The AI's "deferred" write flows can still write to the real database today
Abhishek's explicit verdict on 2026-07-28 was that all six AI write flows (workout log, sleep log, task completion, checklist marking, journal reflection, AI Memory save) are **failed and deferred** — "I will not test this again. I will use manual editing." But the code behind them was never actually disabled. Any ordinary chat message that happens to match the AI's own intent-detection wording — mentioning a workout, saying "rough day," anything that reads like a completed task — can still produce a real confirm card that, if tapped, writes directly to the live Supabase tables. There's no flag, no toggle, nothing stopping it. During a week where real data is going in, an accidental tap on one of these cards could log a fake workout, mark the wrong checklist item, or overwrite a real note.
**Fix:** either physically disable the write-flow trigger path (simplest — comment out or gate `_detectIntent()`'s routing in `aiPanel.js` so it always returns nothing) or add a real kill-switch, not just a product decision documented in a file.

### 2. Deleting a workout session is permanent, with no undo and no recovery
Every other delete in Atlas goes through a confirm step, an 8-second undo toast, and shows up in the Restore view if you change your mind. Workout sessions are the one exception — deleting one from Today's page removes it from the database immediately and for good. If you delete a session by mistake during the testing week, it's gone.
**Fix:** bring workout-session delete in line with everything else — soft-delete + Restore-view coverage, same as tasks/notes/checklist items.

### 3. Reopening a completed project shows a false "failed" error
The reopen itself works — the project really does reopen, and your reason for reopening really does get saved. But immediately afterward, the page tries to call a function that doesn't exist, and you see an error message saying the reopen failed. It didn't. This is purely a trust problem: during testing week, seeing "failed" on something that actually worked is exactly the kind of thing that erodes confidence in the app or causes you to retry unnecessarily.
**Fix:** one-line fix — remove or correct the stray function call.

### 4. A deleted project can still quietly load its old data
Every other single-record lookup in the app correctly excludes deleted rows except one: opening a project by its ID. If a link or a Calendar drill-down ever points at a project that's since been deleted, it'll still open and show that project's old data instead of telling you it's gone.
**Fix:** add the same "not deleted" filter this function is missing, matching every other lookup in `db.js`.

---

## Non-urgent problems — worth fixing soon, not blocking testing

- **The AI's voice reply can silently cut off part of its answer.** The new markdown-cleanup added today strips more than intended: it deletes an em-dash *and everything after it on that line*, not just the dash. Since the AI often uses em-dashes mid-sentence, any spoken reply containing one can lose the rest of that sentence with no sign anything was cut.
- **"Health check-in" style questions can occasionally misfire on unrelated small talk.** The new fallback that catches bare sleep/health questions also matches generic words like "health" or "training," so an off-topic comment containing one of those words could get treated as a health question and pull in 14 days of data it didn't need to.
- **A "Saved" confirmation for AI Memory notes doesn't actually guarantee it saved to the cloud.** The code was written to wait for cloud confirmation before showing "Saved," but the underlying save function catches its own errors internally — so the wait can never actually fail, and you'll see "Saved" even on the rare case the cloud sync silently didn't go through. (The note is still saved locally either way, so this isn't data loss — just an overconfident message.)
- **A workout-history chart can go blank with no explanation.** If loading recent workout data for the weekly progress dots fails, it just fails silently — the dots disappear with nothing telling you why.
- **Reordering a checklist item does two separate saves instead of one.** If the connection drops between the two, the order can end up slightly inconsistent until the next reload. Cosmetic, self-heals on reload.
- **One old doc (`handover-docs/CLAUDE.md`) still mentions an outdated cache version number.** Harmless, just stale text.
- **The deploy pipeline also deploys a `staging` branch into a staging subfolder on the server**, which doesn't quite match the documented "only `main` deploys anywhere" rule. Worth a quick check on whether that's intentional leftover or should be removed.

---

## Phase 2 — fine to leave for later

- **A folder of "entity" definition files (`js/entities/*.js`) exists but is never actually used anywhere in the app** — not imported, not read from. It's dead weight that still gets downloaded/cached on every install. Either wire it into something real (it could be a natural home for the AI's schema awareness) or delete it.
- **Workout sessions have no soft-delete system at all**, which is the deeper reason behind Urgent item #2 above — a same-day patch can stop the *immediate* danger, but giving workout sessions the same soft-delete + Restore infrastructure every other entity has is a real, slightly bigger piece of work better suited to Phase 2.

---

## What's confirmed solid — no action needed

- **The "only `db.js` talks to Supabase" rule holds everywhere** — no other file makes a direct database call.
- **No leaked secrets anywhere client-side** — only the intended public anon key is present; the Cloud TTS service account key is correctly kept server-side in the Edge Function.
- **No dead/unreachable AI fact-package builders** — the exact bug pattern that caused the "doesn't see yesterday's data" incident earlier this session was checked for again and not found elsewhere.
- **The Restore view already covers every soft-deletable table Calendar reads from** (Projects, Tasks, Notebook, Project Notes, Task Logs, Checklist Items/History, Sleep, Workout) — no gap there.
- **The deploy pipeline is consistent**: the live cache version, `PLAN.md`'s documented version, and the actual latest migration file all agree with each other.
- **No duplicate function-declaration landmines** found in any of the ten core page files reviewed.
- **The onclick/window-binding bug class that broke a sibling app's streak buttons doesn't apply here** — Atlas's whole UI is wired through Alpine's own `@click` bindings inside component scopes, not a manual `window.*` bridge, so there's no list to fall out of sync with.

---

*Produced by three parallel research passes (AI layer / core pages & reliability / deploy & infra) against commit `ebc140a`, synthesized by Claude Code (Sonnet 5). No fixes applied — this is the audit only.*
