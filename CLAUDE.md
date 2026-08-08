# CLAUDE.md — Atlas project rules

**This file applies to ANY agent working on this repo — Claude Code, Antigravity/Gemini, or anything else. These are the rules of the project, not the rules of one tool. Do not deviate from any of them without asking Abhishek first.**

Two other docs sit beside this one and are equally load-bearing:
- [`PLAN.md`](PLAN.md) — the current state of the world: what's live, what's mocked, what's planned, what's still an open question. Read this at the start of every session.
- [`SESSION_LOG.md`](SESSION_LOG.md) — the running log of every session. Read the last 2–3 entries at the start of every session so you know what the previous agent shipped. Append a new entry before ending every session.

For everything not covered here (history, phased roadmap, detailed tokens, module boundaries, design-review process), the canonical detailed doc is [`handover-docs/CLAUDE.md`](handover-docs/CLAUDE.md) — this file is the tight summary; that file is the full record. When the two disagree, this file wins (it's the current-truth version).

---

## Account switch (2026-07-29)

This file reflects the state as of the last session on Abhishek's own Claude account. Starting now, sessions will run from a **different Claude account (his wife's)**, against this exact same GitHub repo and Supabase project — the codebase and backend are unchanged, only the account running the session is different. **Every rule in this file is still non-negotiable regardless of which account is running.**

Any new agent, on either account, should always:
1. Read `PLAN.md`'s **"Recommended next sequence"** section, plus its **"Account handover"** section (added the same day as this note) for the specific Atlas AI Phase 1 status.
2. Read the last 2-3 entries in `SESSION_LOG.md`.
3. Treat everything in this file as binding, exactly as if it were the same account continuing.

---

## About Abhishek

He is not technical. Talk in plain English. Never dump code at him for approval — describe what changes and why. Any real design/layout weight goes through the mockup-first review process (mockup → approve → build), documented in `handover-docs/CLAUDE.md` at the bottom.

---

## The design token system — **never invent new tokens**

Every colour, spacing value, motion timing, and font family lives in `Deploy/css/tokens.css`. If you find yourself typing a hex, an `rgba(...)`, or an ad-hoc `padding: 13px`, you are almost certainly doing it wrong. Read the token in and use it. If the token you need doesn't exist, **stop and ask** — a new token is a design decision, not an implementation detail.

### Semantic accent meanings (locked)

Every accent has a fixed meaning across the app. Do not overload one for another purpose.

| Token             | Meaning                                                   | Where you'll see it |
|---|---|---|
| `--accent-sage`   | Done, progress, positive completion                       | Task done checkmarks; checklist "done" state; short-term goal accent; workout day; progress bars |
| `--accent-blue`   | Tasks, planning, primary neutral action                   | Primary buttons; task badges; long-term goal accent; active nav underline; full-rest day icon |
| `--accent-lilac`  | Projects, creative/calm secondary                         | Project chips; active-recovery day pulse |
| `--accent-coral`  | Caution, relapse, missed, overdue, destructive            | Delete buttons; overdue tag; missed-checklist bars; streak relapse action |
| `--accent-amber`  | Skipped (deliberate self-skip), grace, reminder metadata  | Checklist skipped in ring/trend/mini-dots; grace-day-used streak meta; reminder eyebrow labels |

The Round 2 build unified this across the whole app — the checklist ring, the trend chart, the mini-dots, and every consumer now all read: **sage = done · amber = skipped · coral = missed**. Do not fork this.

### Project-identity palette (added 2026-07-31 — separate from the 5 semantic accents above)

Projects can now be assigned one of **10** colours, not 4 — `sage`, `blue`, `lilac`, `coral`, `amber` (the same 5 tokens as the semantic table above) plus 5 new **deep-shade variants**: `forest` (deep sage), `indigo` (deep blue), `plum` (deep lilac), `rust` (deep coral), `bronze` (deep amber). All 10 live as real tokens in `tokens.css` (`--accent-forest`, `--accent-forest-tint`, `--accent-forest-tint-hover`, etc., both themes), computed as an HSL lightness/saturation shift of the existing 5 base hues — not arbitrary new colours. Explicit go-ahead from Abhishek for this expansion ("go in shades in the same color palette... colors will not destroy the code, it's not logic, these are colors") after a real complaint that 4 options wasn't enough to tell projects apart.

**These 5 new tokens are project-identity-only.** They carry none of the 5 locked semantic meanings above (done/tasks/projects/caution/skip) — never repurpose `forest`/`indigo`/`plum`/`rust`/`bronze` for a status or state cue, only for a project's own colour identity (monogram chip, colour dot, task-row identity chip, KPI project chip, workspace hero dot). `COLOR_KEYS` in `Deploy/js/pages/projects-list.js` is the single list driving the picker — if a future session wants to add an 11th, extend that array plus every `.color-<key>` CSS rule set (monogram-chip, color-dot, status-text, kpi-proj-chip, ws-dot, id-chip) the same way, not just the picker.

### Never do

- Hardcode a hex colour anywhere except `tokens.css` itself.
- Hardcode an `rgba(...)` tint outside `tokens.css` — every accent has a per-theme `-tint` and `-tint-hover` token; use those instead.
- Add a new accent without asking. If a UI needs a new semantic colour, that's a discussion, not a task.
- Reach for a colour that already means something else (using coral for a "positive" streak, using sage for an "overdue" state, etc.) — the semantic meaning is the whole point.

---

## Locked interaction rules

These are settled decisions from real design-review rounds. Do not re-litigate them without asking.

### a) Destructive actions require a second deliberate step
- **Delete** (task, reminder, project, note, checklist item, log entry) always goes through `askConfirm()` from `components/confirm-dialog.js` — never `window.confirm()`. And every delete also queues an **8-second undo toast** via `showUndoToast()`. Two steps + a safety net.
- **Done** (marking a task/reminder complete) uses an **inline two-tap confirm**: first tap arms the row (checkbox goes sage-tinted, an inline "Tap again to confirm" hint appears in the meta line); second tap within 2.5 seconds commits; expiry clears silently. Prevents accidental completion from an errant tap.
- **A bare X delete icon on a row is never allowed.** Delete for tasks/reminders lives **inside the edit modal** (bottom-left, outline coral, visually separated from Cancel/Save). Delete for projects lives in the workspace's **⋯ overflow menu**. If you find yourself sketching a per-row ✕ icon, stop.
- Every soft-deletable entity must appear in the **Restore view** (`pages/restore.js`, config-driven via `SECTION_DEFS`). Adding a new soft-deletable entity means adding one entry there plus the matching `listDeleted()`/`hardDelete()` in `db.js` — never a hardcoded fork.

### b) Time input is always the universal picker
- Every time input in the app is the shared `timePicker12h` Alpine component + the `.tp-numeric` markup: two 2-digit numeric inputs (HH · MM) + an AM/PM segmented control. `inputmode="numeric"` opens the OS number pad on mobile.
- The three-select dropdown pattern is retired. Native `<input type="time">` is banned (browser locale varies, often renders 24-hour by default, and Abhishek's app is 12-hour everywhere).
- The internal value is still a 24-hour "HH:MM" string; every consumer's read/write code is unchanged. Only the markup differs.
- If you need a time input in a new place: copy the markup snippet from an existing consumer (Today's task modal, workspace task modal, or the checklist Log popup). Do not roll a new picker.

### c) Goals live inside the Project workspace hero
- Short-term and long-term goals live in the hero card's right column, under the ⋯ overflow menu. **No separate "Goals" card below the hero.** Ever.
- Short-term goal carries a **3 px sage left-edge**. Long-term goal carries a **3 px blue left-edge**. That coloured left-edge is the "this is a goal" signal — no badge, no chip, no heading treatment.
- Body text is weight-500, primary text colour, 15 px, generous line-height. Heavier than description, so it reads as important without shouting.
- **No date line inside the goal block.** The "Short-term due" / "Long-term due" countdown metrics in the hero's left column already carry the date. Repeating it inside the goal block is redundancy that was explicitly cut.
- Clicking a goal opens the shared goal-edit modal. Inline editing is out.

### d) Today's Tasks & Reminders card is fixed-height with internal scroll
- Today's Health section uses `.health-row` — `grid-template-columns: 1fr 1fr`, equal-width columns, Sleep on left and Workout on right. The two `.health-panel` cards stretch to equal height via the grid. Collapses to a single column at `≤900px`. (Note: an earlier draft of this rule referenced `.split-60-40` — that class never existed; `.health-row` is the real implementation.)
- `.col-height` = `min-height: 380px; max-height: 600px; display: flex; flex-direction: column`. The height is dictated by the Sleep+Workout column's natural content.
- `.task-list` scrolls internally (`flex: 1; min-height: 0; overflow-y: auto`) when it overflows.
- **The Tasks card outer height must never grow with task count.** No task-list dictating height. No page-length growing. Test with 20+ tasks — the card scrolls, everything else is stable.

### e) Empty states are a "+ Add X" button, not an empty placeholder card
- If a surface has no content yet, show a **single button in the surface's calm-affordance style** (btn-secondary, matching "+ New project"). Content only appears after the first save.
- No "Nothing here yet — click below" empty-cards. No dashed borders pretending to be forms. No skeleton rows.
- Examples currently live: **+ Add note** on Projects list (only shows notes after saving one). **+ Set short-term/long-term goal** in the workspace goal blocks when empty.

### f) Calendar Day Detail is a real card, checklist is grouped by outcome, Health/Tasks share a row (locked 2026-07-31)
- The Day Detail panel (the block that appears below the month grid when you click a date) is `.dd-ledger` — a genuine card (surface-1, border, top-edge, shadow), a big serif date number, and a KPI strip (Checklist fraction / Tasks / Work logs). It previously had no card depth at all; don't strip this back to a bare top-border-only block.
- **The Checklist section is never one row per item.** It shows grouped `Done` / `Skipped` / `Holiday` / `Missed` lines (`selectedChecklistGroups` in `calendar.js`), each naming the actual item names inline, only rendering groups that have entries. Direct, explicit feedback: "nobody is going to read the checklist that much... mention what is done, what is skipped, and what is missed in detail instead of writing everything." A "See full routine" link opens a **read-only** modal (`checklistDrillOpen`) with the full per-item block breakdown for anyone who wants it — no Log button, no marking. This follows Calendar's own standing rule (settled 2026-07-29, after a real bug where inline Sleep/Workout/Checklist editors were built into it and then removed): **Calendar shows what happened, it is never where you change it.** Every section is read-only; changes always happen on the real page (Today, Project workspace, Notebook) via the existing drill-down navigation.
- **All Day Detail sections sit inside `.dd-body`**, which uses `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`. At wide viewports, Health and Tasks naturally flow side by side; at mobile breakpoints the grid collapses to `1fr`. Each section is a `.dd-card` with a colored left-edge accent — there are no named flex containers (`.dd-row-2col`, `.dd-flex-health`, `.dd-flex-tasks` never existed; don't add them).
- Section headers use serif-italic titles with a solid top-border in that section's real locked accent (sage = Health/Checklist, blue = Tasks & Reminders, lilac = Projects & Work Logs, Journal stays uncoloured — same "no locked-accent home" rule as everywhere else). Don't go back to one flat blue icon regardless of section meaning — that was a real, confirmed bug.
- The "AI range" preset row that used to sit above the month grid (This week / Last week / Last 10 days / Next 10 days) was **removed entirely 2026-07-31** — confirmed genuinely non-functional (set a `rangePreset` value nothing else in the app ever read). Don't reintroduce it without actually wiring it to something real.

### g) Insight ticker is a Tactile Tile inline with the Today header (locked 2026-08-09, in testing)

Ticker design was reworked across three mockup rounds and landed here. Locked decisions:

- **Placement:** the tile lives INLINE with the Today header row, filling the space to the right of the title block via a `.ticker-slot` child of `.section-header`. It is NOT on its own row above the hero band. Don't move it back.
- **Visual:** deep-black (`#0d0d0d`) in dark theme / pure white in light theme. 6px softly-rounded corners (never pill). Inset top highlight + real drop shadow via the `--tile-body` and `--tile-shadow` tokens (defined per theme in `tokens.css`). No border, no accent-tint background, no colored left rail — the old "accent-tint fill + colored left border" design was explicitly rejected and is gone.
- **Content — two-tier:** `.ai-ticker-primary` (bold, high contrast, `--text-primary`) carries the task/reminder/insight itself in natural language. `.ai-ticker-meta` (muted, smaller, `--text-muted`) is optional; the AI writes it for context that shouldn't crowd the primary (carried days, project name, reminder time, insight comparison, bill reason). When there's nothing worth adding, meta is empty and the tile shrinks.
- **Carried indication:** a small amber `.carried` pill prefixes the meta line for `carried_task` items — the one remaining accent-color signal on the tile itself. Don't add per-type icons or per-type body-color tints; the tile is meant to be calm and let the content do the work.
- **Mobile:** at ≤720px the `.section-header` wraps and the tile drops beneath the title block. Preserve this — squeezing the tile at narrow widths reads badly.
- **The `atlas-daily-digest` edge function (v5+) generates the `meta` field.** Don't strip it from the schema; old rows without meta already render fine because the client treats it as optional.

---

## Contrast and accessibility (enforced)

- **Body text ≥ 16 px. UI/button text ≥ 15 px. Small labels ≥ 13 px.** No exceptions in either theme.
- **Contrast on both themes.** Every colour goes through the two-theme token system. When touching CSS: check it on Charcoal Muse (dark) AND Paper Studio (light). A design that looks fine on dark but reads as flat/muddy on light (or vice versa) is unfinished.
- **Project chip contrast fix (locked 2026-07-26):** project name on a task row is a tinted chip with hairline border, coloured identity chip on the left. Was previously flat secondary-color text (2.7:1 on Paper Studio, illegible). Do not revert to flat text. **Identity dot → chip (2026-07-31):** the plain coloured dot was replaced with `.id-chip`, a small tinted-initial square (same visual language as the Project card's own monogram), on both Today's task rows and Calendar's Day Detail rows — see the Project-identity palette section above. **Known, flagged, not fixed 2026-07-31:** the chip's own background/text-weight in the live CSS (`--surface-1`, `--text-secondary` weight 400) doesn't actually match this rule's literal wording (`--surface-2`, weight-600 primary) — noticed in passing while doing unrelated identity-chip work, deliberately left alone that session to stay in scope. Worth a real look before assuming either the rule or the code is the source of truth.
- **Checklist ring skipped colour (locked 2026-07-26):** the ring's layer-2 stroke is `--accent-amber` (was `--border-hover`, invisible against `--surface-2`). Same amber used in the trend chart legend and the routine mini-dots. Do not revert.
- **Never hide an interactive control behind hover.** Touch has no hover. Every interactive control must have a visible static affordance at rest (button shape, icon, cursor, focus outline). Hover may add polish (lift, brighten) but cannot carry the "this exists" signal alone.
- **Every animation respects `prefers-reduced-motion`.** The global override in `tokens.css` handles this — if you invent a new animation, don't add a workaround that dodges the override.

---

## Architecture rules (must hold)

Full detail in `handover-docs/CLAUDE.md` under "Reliability" and "Module boundaries." Short version:

1. **`db.js` is the only file that talks to Supabase.** Every read, every write, every soft-delete goes through it. `supabase-client.js` creates the client; `db.js` and `auth.js` import from there.
2. **Every write is verified.** Insert/update use `.select().single()` and check the returned row. Delete/archive/restore/complete/start go through a small database function via `.rpc()`. A null/empty return is a failed write — roll back the optimistic UI.
3. **Soft-delete only.** Hard-delete only from the Restore view with a second confirmation. Every read filters `deleted_at IS NULL` by default.
4. **UUIDs everywhere. No numeric ID counters. No client-invented timestamps.**
5. **Schema changes are new numbered migrations.** Never edit an old migration. Currently at `013_atlas_workout_add_day_type.sql`.
6. **No local-first sync engine, no background queue, no WebSocket subscriptions.** Atlas is fully online. If it can't reach Supabase, the app shows an error, not a queue.
7. **Alpine.js is imported as an ES module in `main.js` and `Alpine.start()` is called manually after every `Alpine.data(...)` registers.** Do not load Alpine via a separate `<script defer src="...cdn...">` tag — it races and silently breaks the app.
8. **Cross-page navigation is a callback passed into the page's `x-data(...)`.** Never `$root` — it resolves to the page's own scope, not the outer app shell.
9. **Every deploy-worthy change bumps `CACHE_NAME` in `service-worker.js`.** Currently `atlas-offline-shell-v19`.

---

## AI Conversational Actions (voice-first logging & creation) — architecture rule, approved 2026-08-07

**Status: planned and approved, build in progress per `PLAN.md`'s `🎯 NEXT UP` section — read that section for the full spec before touching this area.** This section is the permanent rule; `PLAN.md` carries the build detail and sequence.

Every AI-driven write in Atlas — logging sleep, logging a workout, creating a task, creating a reminder, and every future one Abhishek adds over the app's lifetime — goes through **one shared mechanism**, a **Conversational Action**: a name, a field list, which fields are worth actively asking about if unmentioned, and a write target. New actions are added by defining that list, never by hand-writing a new bespoke flow. If a change to this area requires writing a new one-off flow instead of a new Conversational Action definition, stop — that means the mechanism has drifted from its intended shape.

**Locked rules for this mechanism, do not weaken any of them:**
- **A draft persists across the whole conversation.** No AI write flow may judge a single message in isolation while claiming to be "collecting" information — if it can't remember what was already said two turns ago, it isn't a Conversational Action.
- **Ask about one missing field at a time, in plain language — never a bulk checklist, never silently drop an unmentioned field without asking.** The user must be able to say "I don't have that" and have the field marked as deliberately skipped, never asked again for that entry.
- **Nothing is ever written to the database without an explicit final confirmation** — a real "yes," spoken or tapped, after Atlas reads the whole draft back. This is the single most important rule in this section: it's what makes voice input safe. A misheard word can produce a wrong draft; it must never be able to produce a wrong write.
- **Voice is Phase A only: a tap-to-talk full conversation (listen → gather → confirm → save), not hands-free/wake-word.** Always-on background listening ("Hey Atlas" with no tap) is a deliberately separate future phase — do not build toward it, even partially, without Abhishek explicitly reopening that as its own decision.
- **No provider lock-in.** This mechanism must work identically on both the local (Ollama) and cloud (Gemini/`pos-partner`) providers, using the existing provider toggle — do not add a code path that only works with one model.

### A log action only starts when he's actually reporting something (locked 2026-08-09)

Confirmed live bug: "I'm gonna do the workout after this" started a workout **log**, which then asked past-tense questions ("how long did it run?") about something that hadn't happened yet. Cause: the log actions' `startPattern` is a bare topic-keyword regex — a lone `\bworkout\b` (or `training`, `session`, `run`, `yoga`, `PR`…) matched regardless of tense, so *talking about* a workout was indistinguishable from *reporting* one.

- Every action in `CONVERSATIONAL_ACTIONS` carries a **`mode`**: `'log'` (reports something that already happened) or `'create'` (makes a future task/reminder). `detectActionStart()` applies a shared intent gate to `mode: 'log'` actions only.
- The gate, in order: an explicit **log verb** ("log/record/track/save…") always starts a log; otherwise a **question** never does; otherwise a **future marker** ("gonna / going to / will / later / tonight / need to…") never does; otherwise a **past marker** ("did / finished / just / was / slept / went / last night…") does; otherwise nothing starts.
- `mode: 'create'` actions are **deliberately ungated** — their patterns already require an explicit verb ("add a task", "remind me"), and a task or reminder is inherently about the future, so future tense is correct there.
- **When the gate blocks, Atlas just chats normally.** His explicit choice — no "want me to log that?" offer, no did-you-mean question. The escape hatch is the word "log" itself.
- Keep this in the gate, not in individual `startPattern`s. New log actions must inherit it for free by declaring `mode: 'log'` — if a future change needs a bespoke per-action tense check, the mechanism has drifted from its intended shape.

### Mentioning something is not instructing it (locked 2026-08-09)

Companion rule to the log-intent gate above, for the OTHER write flows (`_detectIntent()` in `ui/aiPanel.js` — complete/start/pause/delete task, mark checklist, journal). Those were bare keyword regexes with the same disease: the lone word "skipped" anywhere in a message routed it to `mark_checklist`.

Confirmed live: the ticker put *"I noticed you skipped your Dinner and D3K2 routine last night. Everything alright?"* into the chat box, "skipped" matched, extraction found nothing to mark, and the conversation dead-ended on *"I couldn't identify which routine items you meant."* **A plain question was captured by a write flow and answered with an error instead of a reply.** This is a large part of why the assistant reads as a rigid form-filler rather than something you can talk to.

`looksLikeWriteInstruction()` (`features/conversationalActions.js`) now gates `_detectIntent()`: an explicit action verb always wins; otherwise a question is never an instruction; otherwise a sentence about what *Atlas* did or noticed ("you skipped…", "you said…") is never Abhishek reporting his own action. Don't add new write-flow triggers as bare keyword tests that bypass this gate.

### The insight ticker decides by judgement, not thresholds (locked 2026-08-09)

- **`carried_task` and `stalled_task` are different things and must never be conflated.** Carried = never started. Stalled = he started it and it's still open. Calling a running task "carried" was a real reported bug; so was the over-correction that hid running tasks entirely. Both types are gathered, both are offered to the model, and the client rechecks them differently (`aiVisibleInsights` in `pages/today.js`).
- **No hard show/hide threshold in code.** Abhishek's explicit framing: the AI should weigh "not the 24-hour data but the weeks, or maybe a few weeks' data" and decide what deserves his attention. The digest passes a 28-day context block into the ranking prompt. Guidance like "a task open 2+ days is usually worth showing" belongs in the prompt as guidance — never as an `if` in the gathering code.

### Atlas may READ Finance Manager's tables, never write them — and must fail open (locked 2026-08-09)

The insight ticker suppresses a bill that's already been paid. That requires reading Finance Manager's `recurring` and `transactions`, which the `atlas-daily-digest` Edge Function already did server-side and `db.js`'s `FinanceBills` now does client-side. Rules:

- **Read-only, and only from `db.js`** on the client (the architecture rule stands — no page-level Supabase calls).
- **Mirror Finance's own cycle-key rule; never invent a second one.** Confirmed from live data 2026-08-09: `cycle_key` is the `YYYY-MM` of the **due month**, across every frequency Finance uses (`monthly`, `quarterly`, `yearly`). There are no weekly or daily recurring bills.
- **Only allowlisted frequencies are paid-checked** (`BILL_PAID_CHECK_FREQUENCIES`). A weekly/daily bill would need a genuine per-occurrence key — rather than guess one, those skip the check and stay visible. Extend the list only after reading Finance's real rule for that frequency.
- **Never derive a missing `cycle_key`** from a transaction's date. Ignore those rows instead.
- **Fail open, always.** If the check can't run or can't be certain, show the bill. Re-showing a paid bill is a nuisance; hiding a genuinely unpaid one is real harm. This is the whole reason the rules above are conservative — don't "tidy" them into something more aggressive.
- `recurring.start_date` is **not** a paid signal. Finance advances it for some bills and not others (confirmed live).

### Voice input: Google Cloud Speech-to-Text, NOT the browser API (locked 2026-08-09)

- **The browser's native `SpeechRecognition` API is banned for voice input.** It was tried and removed after real failures: sessions ending themselves regardless of `continuous: true`, transcripts finalising mid-sentence at a misjudged pause ("catches half words"), and the mic occasionally transcribing Atlas's own TTS reply. These are properties of live streaming recognition, not bugs that can be patched.
- **The replacement is record-then-transcribe:** `MediaRecorder` captures a complete clip (no pause detection, no silence timer — it records until the user taps stop, with a 3-minute safety cap), then the clip is POSTed to the `atlas-stt-proxy` Edge Function, which returns plain text. Transcription is not live/word-by-word, and that's the deliberate trade for reliability.
- **GCP prerequisites — both are required, and missing either produces a 100% failure rate:** (1) the **Cloud Speech-to-Text API must be enabled** on the GCP project, and (2) the service account behind the `GCP_SERVICE_ACCOUNT_KEY` Supabase secret (`pos-tts-proxy@project-80489c04-...`) must hold **`roles/speech.client`**. Both were missing when STT first shipped and cost a full debug cycle — Text-to-Speech and Vertex AI being enabled does NOT imply Speech-to-Text is. If voice input starts failing wholesale after a GCP change, check these two first.
- **Never hide the upstream Google error.** `atlas-stt-proxy` returns Google's real status and detail (with a plain-English translation for the API-disabled / 403 / 400 cases) and `aiPanel.js` passes that message through to the UI. The original version logged the detail server-side and returned a bare generic error, which made a total-failure bug undiagnosable from the app. Don't reintroduce a generic catch-all here.
- **Codec: `audio/webm;codecs=opus` only.** Android Chrome, Chrome, and Edge all produce it; the proxy declares `WEBM_OPUS` to Google and rejects anything else with a clear message. Safari/iOS (MP4/AAC) is deliberately unsupported — Abhishek has no Apple devices in the family (confirmed 2026-08-08), so don't spend effort on that path.

---

## Local dev

- Static server from `Deploy/`. No build step. Serve via `.claude/launch.json`'s `atlas-test` config (or equivalent) at http://localhost:5520.
- **Local dev talks to the LIVE Supabase project.** There is no separate test database. Do not sign in from localhost and click around unless you're deliberately testing a real DB write. For visual-only verification, boot the server, confirm the login screen renders with zero console errors, then stop.
- Real testing happens on the deployed app at `atlas.abhisheksikka.com` — that's Abhishek's review surface.

---

## Working preferences (from Abhishek)

- **Commit and push after every completed pass in Atlas.** He can't review from localhost; the deployed app is his review surface. Do not hand off "waiting to push" — ship, then he tests. Any post-live-testing fixes are the next pass.
- **Design work first, code work second.** For anything with real visual/layout weight, produce a mockup artifact (Claude Artifact or equivalent) using Atlas's real tokens on both themes. Get approval. Then plan the build. Then build. Full process at the bottom of `handover-docs/CLAUDE.md`.
- **Plain English default.** When flagging design decisions back to him, name the tier a control lives at ("secondary metadata, right-aligned") — not just the visual ("small grey label").
- **Never skip hooks.** No `--no-verify`, no `--no-gpg-sign`. If a hook fails, fix the underlying issue.

---

## When rules conflict

- User-in-chat wins over any file in the repo.
- This file (`CLAUDE.md`) wins over `handover-docs/CLAUDE.md` when they disagree — this is the tight current-truth version; that is the full-history reference.
- `PLAN.md` describes state (what IS); `CLAUDE.md` describes rules (what MUST). When acting on a `PLAN.md` item, the `CLAUDE.md` rules still apply.
- If a rule genuinely doesn't fit the situation, **ask Abhishek before doing something different**. Standing decisions were hard-won; changing one silently is worse than pausing to check.

# Cross-Model Continuity (Phase 4 State)
Because Abhishek switches between Gemini (Antigravity) and Claude, all agents must treat `PLAN.md` and `SESSION_LOG.md` as the absolute source of truth for current state. 
**Current Phase 4 State (As of 2026-07-26):**
- **Project Lifecycle Complete:** Projects are formally separated into Running and Completed. Completed projects are strictly read-only in the workspace. Reopening captures a required reason. Task pause/resume mechanics are fully functional. Completion blocking dialogs use in-app `askConfirm`, never Windows alerts.
- **Visuals Shipped:** Dark-mode tokens have been fully refreshed to a warm-charcoal aesthetic (`#1a1a1a`, `#202020`), dropping any previous bluish tints. The Running Now hierarchy uses semantic text classes.
- **PENDING DESIGN POLISH (Do Not Re-litigate Now):** The `.project-card-completed` visual design is functional and uses correct Atlas tokens, but it is visually unsatisfying and washed out. **This is accepted as-is for now.** Treat it as a future polish item, not an active bug.

# Strict Development Discipline

1. **Plan before code**: Never implement immediately. First inspect the current repo state and return a short implementation plan for approval. Only code after explicit approval.
2. **No patchwork**: Avoid patched, fragile behavior. Do not use inline styles, ad-hoc workarounds, page-level DB writes, or "temporary" hacks when a small root-level fix is the correct answer.
3. **Respect architecture boundaries**: 
   - Styling belongs in CSS/classes/tokens.
   - UI behavior belongs in the correct page/controller files.
   - Data writes must go through the proper verified shared DB methods.
   - If a required method does not exist, say so and propose the clean source-of-truth addition first.
4. **Verify before assuming**: Do not assume token names, dialog APIs, DB methods, schema rules, or deployment state. Check the actual code first and say what exists vs what needs extension.
5. **No false completion claims**: Do not say something is implemented, committed, pushed, or live unless it has actually been done and verified (e.g. explicitly running "git push").
6. **Keep output concise and practical**: Use plain English, short plans, exact files, and concrete behavior changes. Avoid inflated AI-manager wording.
7. **Product meaning must match UI behavior**: If a state like Completed, Paused, Running, or Reopened exists, its visual treatment, available actions, and lifecycle meaning must all align.
8. **If something is unclear, flag it instead of guessing**.
