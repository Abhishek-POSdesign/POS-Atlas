# PLAN.md — Atlas state of the world

**Read this at the start of every session, regardless of agent.** It tells you what's actually live vs. what's still on paper vs. what hasn't been touched yet.

Sibling docs:
- [`CLAUDE.md`](CLAUDE.md) — the rules (don't deviate; ask first)
- [`SESSION_LOG.md`](SESSION_LOG.md) — running log of every session (append before ending yours)
- [`handover-docs/CLAUDE.md`](handover-docs/CLAUDE.md) — full history + detail
- [`handover-docs/SLEEP-ROADMAP.md`](handover-docs/SLEEP-ROADMAP.md) — sleep future plan

**Last updated:** 2026-08-09

## ✅ Testing day closed — his verdict landed, fixes in flight on a branch (2026-08-09)

The 2026-08-09 full-day testing round is **over**. Abhishek came back with a consolidated list of six items. Voice input (Google Cloud STT) and typed sleep logging via the Conversational Action flow were both **confirmed working** by him and are not in question.

**His six items, and where each one stands:**

| # | Item | Status |
|---|---|---|
| 1 | AI starts a workout **log** when he's only talking about a future workout ("I'm gonna do the workout after this" → "how long did it run?") | **Fixed** on branch |
| 2 | Move Routine off the Today dashboard to its own page — checklist + **medicines** + **nutrition/supplements** | **Pass 2**, mockup-first, not started |
| 3 | Can Atlas shrink to a small always-visible desktop card / side panel showing just tasks + reminders? | **Answer only**, no build — he asked for a feasibility answer |
| 4 | Insight ticker labels a **running** task as carried | **Fixed** on branch |
| 5 | Tapping the ticker opens the chat with the question phrased backwards (assistant's voice, sent as his message) | **Fixed** on branch (needs the Edge Function deploy to take effect) |
| 6 | A bill already paid + marked paid in Finance Hub still shows as due | **Fixed** on branch |

**Everything is on the branch `feature/atlas-improvement-001`, NOT on `main`, so it is NOT live yet.** He asked for a dedicated feature branch and for nothing to be committed or pushed to `main` without him asking. Atlas only deploys from `main`, so these fixes reach `atlas.abhisheksikka.com` only when he says to merge.

**⚠️ One step still outstanding: `atlas-daily-digest` has NOT been redeployed.** The function source in this repo is at the fixed version (issues 4, 5 and 6 server-side) but the **live function is still v5**. The deploy was blocked by a tooling permission and needs Abhishek's go-ahead. Until it lands:
- Issue 5 (backwards chat question) is **not** fixed for him — the wording is generated server-side, so nothing changes until v6 runs.
- Issues 4 and 6 **are** already handled for him by the client-side live rechecks, which were deliberately written to work on the existing v5-written insight rows (see the section below).

**Order of work he chose:** bugs first and ship so he can test → then the Routine page as its own designed pass with a mockup. Don't jump ahead to Routine.

---

## 🖥️ Item 3 — "can Atlas shrink to a small always-visible card?" — feasibility answer (2026-08-09, no build)

He asked whether closing Atlas could leave a small desktop card showing just tasks and reminders, or whether it could live in a side panel. Researched, not built — he wanted an answer first. Three separate things got bundled into one question, and they have three different answers.

**1. A floating mini-window while Atlas is running — YES, genuinely buildable.** The Document Picture-in-Picture API (`documentPictureInPicture.requestWindow()`) opens a real always-on-top window that Atlas fills with its own HTML — so a stripped-down tasks-and-reminders list, using the existing task row markup and tokens. Supported in Chrome and Edge, and Firefox has since added it too. Needs a click to open (browsers won't let a page do this unprompted). **The catch: Atlas has to still be running.** Close the app and the mini window closes with it. So this is "shrink Atlas down", not "Atlas keeps working after I close it."

**2. A browser side panel — possible, but it's a different product.** Chrome's side panel is an **extension** API (`chrome.sidePanel`, Manifest V3), not something a website or PWA can open. Atlas would need a small companion Chrome extension — a separate thing to build, install, and maintain, on top of Atlas itself. It would work whenever Chrome is open, regardless of whether Atlas is.

**3. A true Windows desktop widget with Atlas fully closed — NO.** Not available to a web app. The Windows notification/calendar flyout widget slots aren't open to third-party web apps either. The only thing that reaches him with Atlas closed today is the push notifications Atlas already sends.

**Recommendation if he wants to pursue it:** option 1. It's the smallest build, reuses existing components, and needs no extension install. Confirm the API is present on his actual browser first (`'documentPictureInPicture' in window`). Not scheduled — waiting on his call.

---

## 🔎 Insight ticker correctness — the three fixes from his 2026-08-09 verdict

All three were confirmed against live data, not guessed. Today's real `atlas_ai_insights` row for 2026-08-08 contained every one of the reported bugs simultaneously.

**Running tasks shown as carried (issue 4).** The digest selected `.in('status', ['not_started','in_progress'])`, so a task he'd already *started* was announced as carried — live proof: "Claude Tutorial", `status = in_progress`, rendered as `carried_task`. The app's single shared rule (`isOverdue()`, `Deploy/js/features/taskStatus.js`) says a running or paused task is never overdue. The digest now selects `not_started` only, **and** Today's `aiVisibleInsights` re-checks each `carried_task` through that same `isOverdue()` so the tile drops the moment he starts a task rather than waiting for tomorrow's row. Keep the two definitions in agreement — don't change one without the other.

**Backwards chat question (issue 5).** `discussInsight()` puts the tile's `discuss` text into the composer as **Abhishek's outgoing message**, but the digest prompt asked Gemini for "an opening line for an assistant." Result: tapping a tile sent *"…is due today. Want to take care of that now?"* as though he were offering to help himself. The prompt now specifies his own first-person voice with worked good/bad examples. The JSON key is still called `discuss` so already-stored rows keep rendering.

**Paid bills still showing (issue 6) — read this before touching the bill logic.** The digest computed a due date purely from `recurring.start_date` + `frequency` and never checked whether the cycle was paid. `start_date` **cannot** be used as a paid signal — confirmed live that Finance advances it for some bills (Airtel, PNB) and not others (Electricity, Altroz, Truecaller).

Finance Manager's real "marked paid" record is a `transactions` row carrying `recurring_id` (the recurring row's `local_id`) and `cycle_key`. **Finance's canonical cycle-key rule, read out of live data on 2026-08-09: `cycle_key` is the `YYYY-MM` of the DUE month.** Verified across all 17 linked transactions and every frequency Finance actually uses — `monthly`, `quarterly`, `yearly`. There are **no weekly or daily recurring bills in the system at all**.

Two deliberate safety rules here, both of which exist so Atlas can never hide a bill that is genuinely unpaid:
- **Only allowlisted frequencies are checked** (`BILL_PAID_CHECK_FREQUENCIES` in the Edge Function, mirrored in `db.js`). A weekly or daily bill needs a real per-occurrence key; rather than invent an Atlas-side version of that calculation, those simply **skip the paid-check and stay visible**. If Finance ever grows one, read its actual rule first, then extend the list.
- **Transactions with a `null` `cycle_key` are ignored**, not given a derived one. Deriving would be a second Atlas-side copy of Finance's rule.

Anything Atlas can't be certain about **fails open** — the bill shows. Re-showing a paid bill is a nuisance; hiding an unpaid one is real harm.

**Atlas's client now reads Finance Manager's tables for the first time** (`DB.FinanceBills.paidCycleKeys()`, read-only, `db.js` only). The Edge Function already read `recurring` server-side; this is the client half, and it's what makes a bill paid *after* the noon digest disappear the same day. It registers each paid cycle under **both** the recurring row's `local_id` and its `uuid`, specifically so the fix works on insight rows written before the digest started emitting `ref.localId`.

---

## 🎤 Voice input (Speech-to-Text) — WORKING as of 2026-08-09

Google Cloud Speech-to-Text via the `atlas-stt-proxy` Edge Function, replacing the browser's native `SpeechRecognition` API entirely (which was banned after real failures — see `CLAUDE.md`'s voice-input subsection for the full rule set and reasoning).

**Two GCP prerequisites, both required, both were initially missing and caused a 100% failure rate:** the Cloud Speech-to-Text API must be **enabled** on the project, and the service account behind `GCP_SERVICE_ACCOUNT_KEY` must hold **`roles/speech.client`**. Having TTS and Vertex AI working does not imply either. Both are now in place.

**`handover-docs/SPEECH-TO-TEXT-IMPLEMENTATION.md` is a portable, self-contained guide** for adding the same STT setup to Abhishek's other apps (which already have TTS). It's written to be handed to an agent in a different repo with zero context from this one — full Edge Function source, full client code, GCP setup with the exact `gcloud` command, gotchas, cost model, and a per-app checklist. **Not yet applied to any other app** — ready to hand over whenever he wants it.

**Note for anyone touching the voice or chat layers:** STT and TTS are completely independent of the chat model provider. Ollama local or Cloud Gemini — voice in and voice out work identically. Never wire voice into the provider toggle.

---

## 🎨 Insight ticker — Tactile Tile redesigned 2026-08-09, IN TESTING (feedback pending)

**Read this before touching anything ticker-related.** The old accent-tint-fill + colored-left-border + icon-eyebrow ticker (which sat on its own row above the hero band) was explicitly rejected across two rounds of mockups and is retired. The current design (commit `c5410e6`):

- **Placement:** inline with the Today header row, filling the horizontal space to the right of the title block (not on its own row). At ≤720px viewport the tile drops beneath the title block instead of squeezing.
- **Visual:** deep-black (`#0d0d0d`) in dark theme / pure white in light theme. Softly rounded 6px corners (never pill). Inset top highlight + real drop shadow that physically lifts it off the page ground. New `--tile-body` and `--tile-shadow` tokens in `tokens.css` per theme.
- **Content — two-tier:** primary line (bold, high contrast, the task/reminder/insight itself in natural language) + optional muted meta line (context — carried duration, project name, reminder time, insight comparison, bill reason). Meta is left empty when nothing worth adding; tile shrinks accordingly. `carried_task` items get a small amber "CARRIED" pill prefix on the meta line — the only remaining accent-color signal on the tile itself.
- **No per-type accent tint on the tile body.** The type-color signal from the old design was explicit feedback ("too eye-catching"), gone.
- **Edge function `atlas-daily-digest` v5 deployed** with an updated prompt that generates the new `meta` field alongside `text`/`title`/`discuss`. Old rows without meta still render fine (`meta` defaults to empty).

**Status: IN TESTING, awaiting Abhishek's live feedback after he wakes up.** Shipped at ~5am his time with no live-test cycle. He'll retest on both desktop and mobile. If anything breaks on real viewport widths, or if the AI-generated meta lines don't read right after the next noon-IST cron, that's the immediate follow-up. Do not treat this as settled until he confirms.

**Rules not to walk back silently:**
- Don't reintroduce the accent-tint-fill background or the colored left border without a new design round.
- Don't move the ticker back to a full-width row above the hero band; inline-with-header is a direct request.
- Don't add per-type icons or type-color signals inside the tile.

## 🎯 Voice-First Conversational Logging + AI action layer — comprehensive build 2026-08-08, re-test still needed

**Read this section before touching this area.** Phase 1 built 2026-08-07 (commit `3df7bb2`), then two rounds of live-testing fixes, then — per Abhishek's own explicit request for one systematic pass instead of one-bug-at-a-time patching — a much larger comprehensive build, commit `92f4637`. Full detail in `SESSION_LOG.md`'s 2026-08-08 entries (there are several; read the most recent "comprehensive build" one first). **Current true state:**
- Mic: MediaRecorder + a new Google Cloud Speech-to-Text Edge Function (`atlas-stt-proxy`) replaced the browser's native SpeechRecognition API entirely — that API was genuinely unreliable (sessions ending themselves, occasionally transcribing Atlas's own TTS reply). Tap to start, speak as long as you want, tap again to stop and review before sending — same interaction model as before, real backend under it now. **Not yet human-tested** — this environment has no mic to verify with.
- Task/reminder lifecycle is now fully AI-triggerable: complete (existing), plus new start/pause/delete, all resolving reminders and project-linked tasks the same way as standalone tasks. `create_task`/`create_reminder` can now link to a real project (asked conversationally, resolved against the live list, never blocks the save on a miss).
- Sleep/workout fact packages (what the AI actually sees when discussing trends) now include HRV, resting HR, deep/REM minutes, sleep notes, workout notes, and full session detail (activity type, intensity, per-session notes) — previously the AI could see a score but nothing about why.
- AI chat history syncs across devices now (new `atlas_ai_chat` table, same last-write-wins pattern as the Notebook) — used to be local-only with a 24h wipe.
- The Insight Ticker's blank-until-noon bug is fixed (see the "AI Insight Ticker" section further down for the original feature).
- A model-driven "declined field" mechanism (let the extraction model itself decide a field was skippable) was found and removed — it was the actual cause of REM sleep/notes going unasked even after they were marked `ask:true`. A field can now ONLY be skipped by the user's own direct decline to the specific question asked about it.

Original Phase 1 build (steps 1-3, first pass at 4-5) follows below, kept intact for reference — largely superseded by the above but the core mechanism description still holds.

**What's actually built, precisely:**
- The core mechanism (`Deploy/js/features/conversationalActions.js`): running draft, deterministic missing-field check, one-question-at-a-time, explicit-skip (including compound replies like "no HRV but resting rate was 60" via a `declined` list the extraction call returns), read-back + confirm reusing the existing verified confirm-card/write path (`aiPanel.js`'s `confirmDraft`/`cancelDraft` extended for a `__conv:` flowKey prefix — the DB write plumbing itself is untouched).
- **log_sleep and log_workout** moved onto it (old single-shot `_detectIntent()` triggers removed, superset regex reused so nothing that used to start a log stops starting one).
- **create_task and create_reminder** — the two brand-new actions the plan called for, first-ever conversational task/reminder creation. Writes via `DB.Tasks.create()`, matching the exact row shape `today.js`/`project-workspace.js` already use.
- **Phase A voice loop**: `voiceExchange()` (single-utterance, auto-sends on natural pause) + `_autoContinueVoice()` (auto-relistens after each spoken reply) — tap the mic once to start a voice-initiated action, then it keeps listening/replying by voice until saved or cancelled. Demotes to manual the instant the user types instead of speaking (tracked via `_lastInputWasVoice`, cleared only by a real keystroke, not by voice setting `draft` programmatically).
- Safety: a spoken yes/no that matches both patterns ("no wait, yes") is treated as unclear and re-asked, never guessed — confirmed this is the one thing that must never fail.

**Known gaps, honestly flagged, not yet closed:**
- Step 4 ("looser trigger phrases") is only partial. `log_sleep`/`log_workout` reuse the old broad keyword regex (a real superset of the old behavior). `create_task`/`create_reminder` use fresh but fairly literal patterns ("add/create/make/new task", "remind me"). A genuinely generic opener like **"I want to log my data"** (no sleep/workout keyword at all) still won't match anything and will fall through to plain chat — the exact failure mode the whole rebuild was meant to fix, not yet solved for that specific phrasing. Worth a follow-up pass once real usage shows which openers Abhishek actually says.
- Zero live/human testing of the actual multi-turn conversation, voice loop, or a real save. Next session (or Abhishek directly) should run through: typed sleep log with a decline, typed task creation, and — if he's on a device with mic access — one real voice-driven log end to end.
- The original build-order step 5 line item ("full voice loop wired through everything above") is built for log_sleep/log_workout/create_task/create_reminder uniformly (it's generic, not per-action), so no separate wiring pass is needed per-action going forward — new actions just get the loop for free by being added to the registry.

Original approved plan follows, unchanged, for future reference:

### The problem this replaces

Atlas already has an AI write-flow system (`WRITE_FLOWS` in `features/aiContext.js`, the two-call extraction architecture in `ui/aiPanel.js`) — but it was found, on close reading, to be fundamentally **single-shot**: every message is judged completely alone, with no memory of earlier turns in the same logging attempt. If you say "log my sleep, 8 hours, score 77," it extracts exactly those two fields from that one sentence and immediately shows a confirm card — it never asks about anything you didn't mention, because there is no mechanism to ask a follow-up question and remember the answer. This is also *why* the intent detector only recognizes very specific keyword patterns — a natural opening like "I want to log my data" matches nothing and silently falls through to plain chat. And task/reminder **creation** was never built as a flow at all — only marking an existing task done. This all lines up with Abhishek's own account of the earlier attempt: real bugs, not a vague complaint (see `PLAN.md`'s older "AI layer" backlog entry below, now superseded by this section).

### What Abhishek actually wants (his words, condensed)

Talk to Atlas the way you'd talk to a person — "Atlas, log my sleep" — and have it hold an actual back-and-forth: it asks about what you didn't mention, one thing at a time ("you didn't mention HRV — do you have that, or should I leave it blank?"), you can say no and it moves on, and only once everything is filled or deliberately skipped does it read the whole entry back and ask "should I add it?" Nothing saves without that explicit yes. He wants this to work by **voice** as much as possible, since he'll be using it on the go, not sitting typing. And he wants this built as a **durable pattern**, not a one-off feature — he's explicit that he'll want dozens more of these over the years this app is in use, and each new one should be cheap to add, not a rebuild.

### The core mechanism — one pattern, reused forever

Do not build "sleep logging," "workout logging," "task creation," and "reminder creation" as four separate hand-written flows. Build **one mechanism**, called a **Conversational Action**, that all four (and every future one) plug into. A Conversational Action is just:
- a name,
- a list of fields it needs,
- which of those fields matter enough to actively ask about if not mentioned (vs. fine to silently leave blank),
- and where the finished draft gets written once confirmed.

**How one conversation runs, step by step:**
1. The user says something that starts an action ("log my workout," eventually just "Atlas, log this").
2. Atlas opens a running draft for that action and **keeps it alive across every message in the conversation** — this is the actual fix for the old bug. Nothing that was already said gets forgotten turn to turn.
3. After each message, Atlas checks — in plain deterministic code, not by asking the model to remember — which important fields are still empty, and asks about exactly **one** of them at a time, conversationally.
4. "I don't have that" marks the field as deliberately skipped, not missing — it is never asked about again for that entry.
5. Once every field is filled or explicitly skipped, Atlas reads the whole draft back in one sentence and asks for confirmation.
6. **Only an explicit yes writes anything to the database.** This is a hard rule, not a preference — see the matching entry in `CLAUDE.md`. It exists specifically so a misheard word from voice input can never silently corrupt real data.

The confirm-card UI and the actual verified database write (`flow.write()`, `verifiedInsert`/`verifiedUpdate`) already exist and already work safely — none of that changes. Only what happens *before* the confirm card appears is being rebuilt.

### Voice — two phases, only Phase A is part of this build

- **Phase A (this build):** a real spoken back-and-forth. Tap the mic once, then the entire gather-questions-confirm conversation happens by voice — Atlas listens, Atlas replies out loud, no typing or screen-reading required until it's done. Atlas already has both raw pieces (`toggleVoice()` for speech-to-text, `_speak()`/Cloud TTS for text-to-speech in `aiPanel.js`) — they're just not wired into a multi-turn conversation today. This is genuinely buildable now.
- **Phase B (explicitly NOT part of this build — a separate future decision):** always-listening, hands-free, true "Hey Atlas" wake-word activation with no tap at all. This is a materially bigger, separate piece of engineering (background mic access has real battery/privacy/browser limitations — most mobile browsers won't let a website listen in the background at all). **Do not start Phase B without Abhishek explicitly reopening it as its own conversation.** Building toward it silently while "just doing Phase A" is exactly the kind of scope-creep this note exists to prevent.

### What gets built, in this order (do not reorder)

1. **The Conversational Action mechanism itself** — the running draft, the missing-field check, the one-question-at-a-time follow-up, the final read-back-and-confirm. Build and prove this against **sleep logging first**, since it already exists today and gives a direct old-vs-new comparison.
2. **Workout logging moved onto the same mechanism.** Should be fast — same pattern, second instance.
3. **Two brand-new actions: create a task, create a reminder.** The first genuinely new capability this unlocks — these don't exist as conversational flows at all today, only "mark an existing task done" does.
4. **Looser trigger phrases** so natural language ("I want to log my data," "add a task") reliably starts the right conversation — and if it's genuinely ambiguous which action is meant, Atlas asks instead of silently doing nothing (today's failure mode).
5. **The full voice loop wired through everything above** — Phase A only, per the scope note.

### Model choice — settled, do not relitigate

This does **not** require Claude specifically, and does not require locking the whole app to one provider. The intelligence needed is narrow — pull a value out of a sentence, phrase a short natural follow-up question — and both the existing local (Ollama) and cloud (Gemini via `pos-partner`) options can do that adequately. The actual reliability of this feature comes from the deterministic "what's still missing" logic living in plain JavaScript, not from which model answers. Keep the existing provider toggle exactly as it is; do not add a Claude-only code path.

### Why this is built this way — for whoever picks this up years from now

Every future "log X" or "create Y" idea Abhishek has should mean writing down what it needs, in plain English, and slotting it into this same mechanism — same safety rule (nothing saves without an explicit yes), same voice behavior, same one-question-at-a-time style. If a future change to this feature means writing a new bespoke flow instead of adding a new Conversational Action definition, that's a sign the mechanism itself has been broken from its intended shape — stop and reconsider before proceeding.

---

## 🆕 2026-08-07 — AI Insight Ticker (daily digest) shipped, plus a real production bug fixed

**A genuinely new feature, explicitly requested and approved by Abhishek in-session (not a backlog item picked up on initiative)** — see `SESSION_LOG.md`'s 2026-08-07 "AI Insight Ticker" entry for the full build detail. Short version: a new Supabase Edge Function (`atlas-daily-digest`) runs once a day at 12:00 PM IST via `pg_cron`, gathers deterministic facts (carried tasks, Finance Manager bills due within 3 days, today's unmarked morning checklist items, yesterday's skipped items, sleep/workout 7-day trend, quiet projects), asks Gemini to pick+phrase up to 5 worth showing, and writes them to a new `atlas_ai_insights` table (migration `024`). Today's page shows them in a rotating "Worth knowing" ticker (`.ai-ticker`, solid accent fill, 8s rotation) that **live-rechecks each item against current state** and drops it the instant it's resolved (e.g. a carried task gets completed) — it does not wait for tomorrow's regeneration. Clicking a slide opens the AI panel pre-loaded with that topic via a new `atlas:ask-ai` window event (listened for in `aiPanel.js`). Separately, the same function reads recent sleep/workout/journal free-text notes and, when it spots a genuine recurring pattern, writes one compact entry into the existing `atlas_ai_notebook` (tagged `source:'auto'`), auto-consolidating once those pile past 6 entries — same memory store the manual Notebook already used, just with a second writer now.

**Also found and fixed while building this: Atlas's live AI chat (`pos-partner`) was silently broken since the Gemini 2→3 migration.** It still hardcoded the `us-central1` regional Vertex endpoint, which 404s for `gemini-3.5-flash-lite` on this project — the exact same bug already fixed in Biz Research Hub/B.tech Learning Hub's `vertex-chat` function, but never actually verified live in Atlas (a prior migration session's notes incorrectly assumed Atlas was "untouched, never broken"). Switched to the true global endpoint (`aiplatform.googleapis.com/.../locations/global/...`, no region prefix) and confirmed live with a real round-trip call. If AI chat seems to have "started working again" with no obvious cause, this is why.

**Cache bumped to `atlas-offline-shell-v88`.**

## 🔒 PHASE 1 CLOSED — ATLAS IS STILL IN THE ONE-WEEK TESTING PHASE

**Abhishek closed Phase 1 of Atlas development on 2026-07-29, across both development tools he uses — Antigravity/Gemini and Claude Code.** This is not a Claude-only decision; treat it as final regardless of which agent/account picks this up next. Atlas is in **one week of real-data testing** (started 2026-07-29). **Formal Phase 2 development has NOT started** — it begins when Abhishek explicitly reopens that conversation, expected the week of ~2026-08-05.

**Important framing, added 2026-07-31 — read this before assuming "Phase 2" has begun:** On 2026-07-31, Abhishek asked for and received a substantial round of fixes and visual work in one extended session (diagnosis + 3 build rounds, all same day) — see `SESSION_LOG.md`'s three 2026-07-31 entries. Some of that work is *labeled* "Phase 2" inside those entries (that's the language used in the moment, matching how the request was framed mid-session), and it does cover some items that were sitting in the Phase 2 backlog below (Day Detail, part of the Projects/Notebook hierarchy pass, the dated Checklist drill-down). **Despite that label, Abhishek's own explicit closing instruction was: this was still testing-week work, not a formal Phase 2 kickoff** — "This is fixed under Phase 1 development itself... we are still in the testing phase... we close the day with this." Treat 2026-07-31 as an unusually large testing-week correction/build session, not as Phase 2 having formally started. The backlog below is updated to reflect what actually shipped, but the same testing-week rules (previous section, still in force) still apply until Abhishek explicitly reopens Phase 2.

**What this means for any agent working in this repo right now, on either tool:**
- **Default to observing, not building** — unless Abhishek explicitly directs a larger session himself, the way 2026-07-31 was. Genuine blockers, data-loss risks, or explicitly-requested work are fine; don't proactively start backlog items on your own initiative.
- **Phase 2 does not start on its own** — it begins when Abhishek explicitly reopens the conversation and frames it as such. 2026-07-31 was not that, by his own words, even though it shipped real Phase-2-backlog items.

**Everything shipped across 2026-07-29's build/fix rounds is live and confirmed deployed** (Calendar page, AI history/future awareness, Cloud TTS, the vivid day-cell pass, four Claude Code live-testing rounds, plus two further mobile-scrolling fixes from Antigravity/Gemini after that — Today page's `.kpi-strip`/`.stat-row` stacking and Calendar's `.dd-section` min-width fix, both confirmed working live by Abhishek) — see "Atlas Calendar," "Atlas AI — history & future awareness," and "Atlas AI voice output" sections below for the full build detail, and `SESSION_LOG.md`'s 2026-07-29 entries for the round-by-round story from both tools.

**Everything shipped 2026-07-31 (three same-day rounds, all pushed and live) — see `SESSION_LOG.md`'s three 2026-07-31 entries for full detail:**
1. **Correction round 2** — a task's project link now behaves the same everywhere (deleting a project safely reassigns its tasks to standalone, atomically, via a rewritten `atlas_projects_soft_delete`, migration `017`); a shared `isOverdue()` (`features/taskStatus.js`) fixes a running/paused task never being falsely shown overdue; a Paused task gets a real neutral tag on Today; the checklist ring updates in place with no page-wide refresh.
2. **Build round** — Calendar Day Detail rebuilt (real card depth, KPI strip, checklist grouped into Done/Skipped/Holiday/Missed instead of one row per item, a read-only "See full routine" drill-down); the Projects Completed card un-washed; Notebook entries collapse/expand; a shared `.id-chip` identity chip replaces bare color dots on Today's and Calendar's task rows; the project badge on Today's rows now jumps to that project's workspace.
3. **Round 3 (density + direct feedback)** — Day Detail's Health/Tasks now share one row instead of each being full-width with empty space; KPI numbers enlarged; a real `day_type` label bug fixed; the non-functional "AI range" row removed from Calendar entirely; project colors expanded 4 → 10 (new `forest`/`indigo`/`plum`/`rust`/`bronze` tokens, deep-shade variants of the existing 5 accents — see `CLAUDE.md`'s token section); Notebook hierarchy and date format (day-first "D Mon YYYY") fixed.

-- **Live at:** [atlas.abhisheksikka.com](https://atlas.abhisheksikka.com) -- **Current cache version:** `atlas-offline-shell-v76` -- **Latest migration:** `017_project_delete_orphans_tasks_safely.sql`

---

## 📋 Phase 2 backlog (do not start until Abhishek reopens, week of ~2026-08-05)

Everything below was explicitly deferred rather than built during Phase 1 close-out, **updated 2026-07-31** to reflect what actually shipped that day (see the banner above — still testing-week work, not a Phase 2 kickoff, even though a few of these items got built). Each item still has its full detail in the relevant section further down or in `SESSION_LOG.md`.

**Shipped 2026-07-31, no longer backlog:**
- ~~Calendar Day Detail redesign~~ — done (Editorial Ledger, mockup-approved, then a density round after live feedback). The separate **Calendar day-cell (month-grid) visual design is still unfinished** — see below, not the same surface.
- ~~A real dated Checklist view~~ — done, but scoped as a **read-only drill-down from Calendar's Day Detail** ("See full routine" modal), not a standalone editable dated Checklist page. If a genuinely separate, navigable, editable dated Checklist view is still wanted, that's a different, larger ask — flag it to Abhishek before assuming this closes that idea entirely.
- **Projects/Notebook visual-hierarchy pass — partially shipped.** Done: the Completed project card (was washed-out lilac-on-lilac, now normal card + a small status chip), Notebook entries (collapsed preview rows, expand on click, date/content hierarchy fixed, day-first date format). **Not done:** a general pass on the Projects list/running-card layout itself beyond the Completed-card fix — still open if he wants more there.

**Design work needing Abhishek's direction first (don't guess, mockup-first as always):**
- **Calendar day-cell (month-grid) visual design is unfinished, by his own words.** He approved the current vivid block treatment to close Phase 1 but said explicitly "I'm not 100% satisfied... next phase I'll have clearer direction prepared." Expect a fresh mockup round, not a continuation of the current look. See "Calendar day-cell vivid pass" below. **Not the same thing as Day Detail (the expanded panel below the grid), which was redesigned 2026-07-31** — this item is specifically about the small colored blocks inside each day cell in the month grid itself.
- **A full whole-app mobile-responsiveness pass — still open.** Day Detail's new layout got its own explicit mobile breakpoint when it was built 2026-07-31 (not a gap), and Projects' grid is inherently responsive by construction (confirmed via CSS, `auto-fill`/`minmax`, no media query needed). The Routine/Checklist blocks and the AI panel were **not** touched or audited 2026-07-31 — a genuine full pass (ideally with real phone screenshots, the method that worked for previous mobile fixes) is still real Phase 2 scope.
- Real priority system + real drag-and-drop reordering (Phase 6 carry-over, needs its own design pass).

**Features, scoped but not started:**
- **Workout "lock this day" feature** — prevent further edit/delete once a workout day is finalized. Abhishek's own explicit gate: "if it needs a data set change, just leave it" — it does (new column), so it waits for Phase 2.
- Screenshot parsing (Garmin/ring app → Vertex AI reads it → confirm card) — placeholder buttons already exist in both Health panels. Explicitly re-deferred 2026-07-31 when Abhishek asked for it again as part of a larger wishlist: this needs a new Supabase Edge Function + a real Vertex AI call + a review-before-save modal, judged too large to fold into a mixed correction/build session. Treat as its own standalone build when picked back up.
- Pattern-of-life insights (sleep/workout correlations) — needs 30+ days of data. Explicitly re-deferred 2026-07-31 for the same reason it was deferred before: Atlas is roughly a week into the testing window, nowhere near 30 days of real data yet. Don't build a hollow version just because it was asked for again — wait for real data.
- Phase 3 Targets (`count_toward_goal` progress-bar goals, alongside the streak kind that already ships).
- Notebook floating/draggable window (currently a modal).
- Workout day-type weekly pattern setter (e.g. "Sundays default to Full Rest").
- **Loading speed — root-caused 2026-07-31, not fixed.** `main.js`/`supabase-client.js` import Alpine.js and `@supabase/supabase-js` directly from jsdelivr as unpinned version ranges, and neither is in `service-worker.js`'s `ASSETS_TO_CACHE` — both block first paint and neither benefits from the offline shell. Fixing this properly means either vendoring local copies or pinning exact versions, both judged too broad/risky for a same-day correction pass (Abhishek's own instruction: "I want stability this week, not a new risk loop"). A contained follow-up, not a mystery.
- **Whole-app date-format audit** — Notebook's dates were fixed to a day-first "D Mon YYYY" format 2026-07-31 after direct feedback that the raw ISO string read in the wrong order for Indian convention. Most other date displays in the app already use a month-name format (`formatTaskDateTime` etc.) which has no day/month ordering ambiguity to begin with, but a real pass confirming every date display in the app is genuinely consistent has not been done.
- **Monogram-letter collisions** — flagged live by Abhishek (multiple projects can start with the same letter, no de-duplication logic). Explicitly deferred at his own request 2026-07-31 ("I'll manage with this until I think of something new... leave this task in the binder for now") — don't build anything here without him raising it again.
- **An unclear point about task status labeling ("posed"/"paused")** raised 2026-07-31 that didn't come through clearly (likely a dictation artifact) — Abhishek explicitly said to leave it rather than guess. If he raises it again, ask him to restate it plainly rather than assuming what "posed" meant.

**AI layer:**
- **SUPERSEDED 2026-08-07 — see the `🎯 NEXT UP — Voice-First Conversational Logging` section at the very top of this file.** The line below is kept for history only; the "needs a real decision" it asks for has now been made — the decision is the new section above, not a kill-switch. The old AI write-flow action layer (FAILED/DEFERRED from 2026-07-28) is being rebuilt on top of, not deleted first — read the new section before touching `aiPanel.js`/`aiContext.js`.
- ~~The AI write-flow action layer remains FAILED/DEFERRED from 2026-07-28, and separately, its trigger path was confirmed still live/reachable during the 2026-07-29 audit — Abhishek's explicit call was to leave it live and observe during the testing week rather than disable it. This needs a real decision in Phase 2: either the full architectural rewrite the original failure verdict called for, or an explicit permanent kill-switch if manual editing is the long-term answer.~~
- Per-view Fact Package binding (every message currently carries `explain_day`/`explain_history` regardless of which page the panel was opened from).
- Web search grounding citations (Cloud/Gemini) — deployed, unverified whether surfacing source links is worth doing.
- TTS's em-dash strip can still cut off part of a spoken reply if the model uses an em-dash mid-sentence (non-urgent, found in the 2026-07-29 audit, not yet fixed).
- AI's bare-topic health-question routing can false-positive on unrelated small talk containing words like "health"/"training" (non-urgent, same audit).
- AI Memory's "Saved" confirmation can't actually detect a failed cloud push — `pushNotebook()` swallows its own errors (non-urgent, same audit; no data loss, just an overconfident message).

**Cleanup / hygiene:**
- `js/entities/*.js` — a folder of schema-definition files never actually imported anywhere, still gets precached on every install. Wire it in or delete it.
- `WorkoutSessions` has no soft-delete infrastructure at all (ties to the hard-delete finding from the 2026-07-29 audit — Abhishek explicitly doesn't want undo added, but the deeper "give it the same infra everything else has" question is still open for Phase 2 if his answer ever changes).
- A workout-progress chart on Today can go blank with no visible error if its data load fails silently (non-urgent, same audit).
- Checklist item reordering does two separate non-atomic writes (non-urgent, same audit, self-heals on reload).
- `handover-docs/CLAUDE.md` has one stale cache-version reference (cosmetic).
- The GitHub Actions deploy workflow also deploys a `staging` branch into a staging subfolder — worth confirming whether that's intentional or leftover.
- **PLAN.md itself has ~95 old mojibake corruption sequences** (em-dashes/quotes mis-decoded, found 2026-07-28) — still not repaired, flagged again here so it doesn't keep getting silently carried forward.

---

## Account handover (2026-07-29)

Abhishek is switching to a different Claude account (his wife's) for future sessions, working against this **same GitHub repo and same Supabase project** — nothing about the codebase or backend changes, only which Claude account is doing the work. Any new agent picking this up, on either account, should:

1. Read this section, then the **"Recommended next sequence"** section further down.
2. Read the last 2-3 entries in `SESSION_LOG.md`.
3. Treat `CLAUDE.md`'s rules as non-negotiable regardless of which account is running the session.

**Phase status at handover:**
- **Phase 5 (Health + Insight Pills) — CLOSED**, per Abhishek's explicit sign-off 2026-07-27.
- **Phase 6 (Tasks & Reminders + sparkline fix + split cards + Upcoming modal) — substantially closed** as of 2026-07-28/29.
- **Atlas AI Phase 1 — conversation panel is live; AI write flows (action layer) are FAILED and DEFERRED.** The panel itself, persona/PIN, hybrid routing, and Memory Notebook all work. All six write flows (workout, sleep, task completion, checklist marking, journal reflection, AI Memory save) have been attempted across multiple fix rounds and have NOT produced reliable behavior in real use. Abhishek's verdict (2026-07-28): "I will not test this again. I will use manual editing." The action layer is deferred to a future full rewrite — see the "AI Action Layer — FAILED / DEFERRED" subsection below.

**What's live now for Atlas AI:**
- Sticky header (`.app-header-sticky`), floating launcher (Atlas's own compass mark), docked AI panel that content-shifts the page rather than overlaying it.
- Persona (7 fields: Role, Job, Targets, Knowledge, About Me, Responsibilities, Strict Instructions) + 6-digit PIN lock (SHA-256 hashed, Forgot/Change both preserve persona + notebook).
- Hybrid routing skeleton: Local (Ollama, non-streaming `/api/chat`, manual model-name field) and Cloud (the sibling apps' shared `pos-partner` Edge Function, called with Atlas's own signed-in session JWT) with a working provider toggle in the header pill and in Settings, kept in sync.
- Memory Notebook: Pin / Save Session / Compact, backed by the new `atlas_ai_notebook` table (migration 016), local-first read with last-write-wins cloud sync.
- ~~Two voice-write flows~~ — **code exists but does not work reliably in real use. Do not present these as live features.** See "AI Action Layer — FAILED / DEFERRED" subsection below.
- Web search opt-in on Cloud: a checkbox (header + Settings) sends `webSearch:true` to `pos-partner`, which now (v2, deployed 2026-07-29) conditionally attaches Google Search grounding -- additive only, the Task Manager and Finance apps calling the same function unaffected.

**What's still to be refined in upcoming sessions** (starting points for the next account, not blocking anything):
- **Provider dropdown behavior and model label** — the click-outside bug is fixed and the pill now shows the real model name, but this was only just fixed this session and hasn't had a full second round of live confirmation yet.
- **Web search on Cloud/Gemini** — just deployed; unverified live whether grounding actually improves answers for real "latest info" questions, and whether `groundingMetadata`/citations from the Vertex response are worth surfacing in the UI (currently just the plain text reply is shown, no source links).
- **Scrollbar visuals** — AI panel, Notebook list, and Tasks & Reminders card scrollbars were tightened twice (6px → 4px thumb, hidden button-arrows) but Abhishek reported them still looking chunky after the first pass; this may be a Windows display-scaling/accessibility setting outside what page CSS can control, not a code bug — worth a fresh look with screenshots from his actual device before assuming it's fixable in CSS.
- **Persona tone / "data reader" avoidance** — the conversation-first system-prompt rewrite (this session) is the real fix attempt, but was not live-tested by Claude before this handover (Abhishek confirmed verbally it's "replying perfectly" after the rewrite, but no side-by-side transcript was captured). Worth a deliberate test pass early next session: try "hello", "how are you", "can we just chat" and confirm the tone lands before building anything further on top.
- **[FAILED / DEFERRED — final verdict 2026-07-28] All AI write flows remain unreliable.** Code exists for 6 flows across multiple implementation rounds (two-call extraction architecture, Track A Memory, pendingUseCase expiry) but real-use testing still showed failures. Workout logging showed a confirm card but was missing VO2 max field and VO2 max was not saved. Task-related flows were confusing and potentially unsafe (task number interpretation led to unexpected task selection). Abhishek's final decision: "I will not test this again. I will use manual editing." This is not a fixable-in-one-more-round issue — it requires a deliberate full architectural rewrite. **Do not touch this layer without a fresh plan and explicit re-approval.**
- **[FIXED 2026-07-29] Google Cloud TTS is live.** Real Neural2 voices replace browser `SpeechSynthesis` for the two cloud voice options. See "Atlas AI voice output — Google Cloud TTS (live 2026-07-29)" below for the full build.
- **[FIXED 2026-07-28] No delete option for sleep/workout log entries** — shipped in the pre-trial bundle (`932a403`). Workout delete resurrection bug then fixed in `e5b603f`.
- **Per-view Fact Package binding** — every chat message still carries `explain_day` as ambient context regardless of which page the panel was opened from (the context badge that would have shown this binding was cut from the UI early on to de-clutter the header). A future session could reintroduce a lighter version of this if it turns out to matter in practice.

---

## Atlas AI — history & future awareness (live 2026-07-29)

Abhishek reported that Atlas AI claimed it "doesn't see logs for yesterday" despite having logged sleep/workout data for the prior 2 days. Root cause confirmed by reading the actual pipeline, not guessed: `features/aiContext.js` already had a `buildExplainHealth()` function that correctly fetched 14 days of sleep/workout data -- but nothing in `ui/aiPanel.js` ever called it. Every normal chat message hardcoded `buildFactPackage('explain_day')`, which only contains *today's* tasks/checklist/streaks -- zero sleep or workout data, ever, for any question. Even the dedicated "Health check-in" quick-action button fell through to the same today-only path instead of reaching the health builder. The system prompt actively told the model to "spot patterns over days/weeks" -- the model wasn't malfunctioning, it was honestly reporting it had never been given anything beyond today.

Fixed as a routing fix, not a rewrite -- the range-fetching approach was already correct, it just needed to actually be wired up and broadened to cover the future too (Abhishek's expanded ask: Atlas should also understand upcoming plan/workload, not just past trends):

- **`db.js`** — 7 new pure-read date-range methods, all following the exact `.gte/.lte/.is('deleted_at',null)` pattern already proven by `Checklist.listHistoryRange`: `Sleep.listForDateRange`, `Workout.listForDateRange`, `Notebook.listForDateRange`, `Tasks.listScheduledInRange` (the method that carries the *future* side -- a future window returns not-yet-done tasks/reminders exactly as planned), `Tasks.listCompletedInRange`, `TaskLogs.listForDateRange` (new: global across all projects, the old `listForProject` only covered one project at a time), `ProjectNotes.listForDateRange` (new: all notes regardless of `project_id`, the old `listGlobal()` only covered notes with no project). No schema changes -- every column already existed.
- **`aiContext.js`** — `buildExplainHealth()` deleted (the exact "unreachable builder" pattern that caused the bug -- leaving it in place just resets the same trap). Replaced with `buildExplainHistory({startDate, endDate, compare, label})`, direction-agnostic (works for a past range, a range straddling today, or a fully future range) and registered as a new `'explain_history'` case in `buildFactPackage(useCase, entityId, rangeOpts)` (third param is new/optional, existing callers untouched). Returns gap-filled per-day sleep data (`"no sleep log"` explicit, never silently omitted), a per-day task-load array (`tasksByDay`, carrying counts + names + `kind`/project for both past-completed and future-scheduled items), precomputed summary aggregates (avg sleep/score, workout count, checklist %, task counts) so the model references real numbers instead of doing its own arithmetic, an optional `comparison` block (always "requested period vs. the period immediately before it" -- direction-agnostic by construction, so "next week vs this week" and "this week vs last week" use identical math), and a `recentContext` block auto-attached whenever the range extends into the future (last 7 days' sleep/workout/checklist summary, so a forward-looking answer can connect to recent reality without a second question).
- **`aiPanel.js`** — new `_detectHistoryRange(text)`, a deterministic regex parser (same style as the existing `_detectIntent()`, no second model call) recognizing both past phrasing ("last N days", "yesterday", "last week/month", pattern/trend language) and future phrasing ("next N days", "next week", "this week", "next month", a named month like "August" resolved to that exact calendar month). `sendMessage()`'s Track C (previously hardcoded `explain_day` for every message) and `_callModelProse()` (Track B's prose companion call) both now route through this detector. The "Health check-in" quick-action chip (`askQuickAction('explain_health')`) no longer silently falls through to `explain_day` -- it bypasses text-routing entirely and calls a real 14-day `explain_history` package directly, same pattern `explain_task` already used.
- **Dev-mode logging** — `_logFactPackage(pkg)`, called at both `buildFactPackage(...)` call sites. Always logs a one-line console summary (`useCase`, date range, per-category row counts); full JSON payload only behind `localStorage.setItem('atlas_ai_debug','1')`.
- **System prompt** (`aiConfig.js`) — new `## WHEN HE ASKS ABOUT PAST DAYS, THE FUTURE, OR TRENDS` section: never re-ask for a number/date/scheduled item already in the facts; name a genuine gap plainly (past: "no log"; future: "nothing planned yet") and never claim data doesn't exist app-wide just because it's outside the given range; talk in real counts for forward-looking workload questions; only ask about genuinely subjective things.
- `Deploy/service-worker.js` cache bumped to `v64`.

---

## Atlas Calendar (live 2026-07-29)

Third main tab (Today / Projects / **Calendar**) -- a full-page, past+future view reading from the exact same `db.js` range methods the AI's `explain_history` Fact Package uses (the section above), so the Calendar and the AI describe the same timeline, never two separate pictures. Mockup-approved in two rounds via Artifact (first: 3 layout options A/B/C using real `tokens.css` values; second, after live testing in Comet: Day Detail moved from a right-side column to full-width below the grid -- Atlas already has a right-side AI panel, two right panels would clash -- plus category filters, range-preset hints, and drill-downs, "Balanced" density picked as the base, Spacious/Dense dropped).

- **`Deploy/js/pages/calendar.js`** (new) -- `calendarPage(nav)`. `loadMonth()` fetches a Monday-start grid window (current month padded to full weeks) via `Promise.all` of the true range methods (never `listRecent`, which is row-count-anchored and wrong for jumping to an arbitrary month): Sleep/Workout/WorkoutSessions/Checklist-history/Checklist-items/Tasks-scheduled/Tasks-completed/TaskLogs/ProjectNotes/Notebook. `days` getter (flat array, not nested by week -- the grid's `repeat(7,1fr)` CSS wraps rows on its own) builds each cell's category-tagged line list, capped at 4 with a "+N more." Day Detail getters (`selectedSleep`/`selectedWorkout`/`selectedChecklist`/`selectedTasks`/`selectedProjectWork`/`selectedJournal`) all derive from the already-loaded month arrays -- zero extra fetches, since selecting a date only ever happens within the visible month.
- **Category filter bar** (Sleep/Workout/Checklist/Tasks/Reminders/Projects/Journal) -- grid-only; Day Detail always shows the full truth for the selected day regardless of filters. Toggle chips use surface+contrast (`.filter-chip.on` = `--surface-2` background), never an accent fill -- CLAUDE.md's "selection is not a status" rule. Tasks and Reminders are separate filter categories even though they're the same `atlas_tasks` table (`kind` field) -- matches how Abhishek actually thinks about them.
- **Range-preset row** (This week / Last week / Last 10 days / Next 10 days) -- explicitly a UI hint for now, not wired to a live query; the real range logic already lives in `aiContext.js`'s `buildExplainHistory` / `aiPanel.js`'s `_detectHistoryRange`.
- **Day cell design** -- small monochrome SVG icons (`iconSvg()`, same `x-html`-into-`<svg>` injection pattern `today.js`'s `sessionIconSvg()` already uses) + short text, never per-category accent colors -- Atlas's 5 locked accents don't map cleanly onto 7 history categories, and inventing a 6th/7th or repurposing a locked one is banned without a separate ask. The only accent in the grid is `--accent-blue` for today/selected cell chrome (UI chrome, not a data-category color, same non-semantic use `.log-date-header` already makes of blue-tint) and `--accent-coral` for an overdue task/reminder count (the existing locked "missed/caution" meaning, not a new one).
- **Day Detail, full-width below the grid, never a modal or right-side drawer** -- updates in place as a different date is clicked. Five sections (Health [Sleep + Workout sub-blocks with duration/score/deep/REM/resting-HR/HRV/notes and day-type/sessions/type/score/calories/VO2-max/notes], Checklist [every applicable item for that weekday, joined with that date's history row if any -- shows "Not logged" for unmarked items, not just marked ones], Tasks & Reminders [scheduled + completed, status chip done/overdue/upcoming, project dot], Projects & Work Logs, Journal) -- a section is simply absent if that day has nothing in it, no empty boxes.
- **Drill-downs reuse existing surfaces, no page/modal duplicated for navigation targets:**
  - **Tasks & Reminders rows** -- `Deploy/js/features/pendingNav.js` (new, tiny module-scoped handoff, not `window.*`) lets Calendar hand a task object to whichever page it navigates to next. Standalone tasks (`project_id` null) go to Today (`nav.onGoToday()`); project-linked tasks go to that Project's workspace (`nav.onOpenProject(id)`, which needed a fix -- the existing `app.openProject(id)` only ever set `projectViewId`, not `tab`, since it was only ever called from inside the Projects tab before; Calendar's `onOpenProject` callback now sets both). Both `today.js`'s `init()` and `project-workspace.js`'s `open(id)` call `consumePendingTask()` and auto-open their own real, already-existing task edit modal -- confirmed via code that Atlas has no single shared task-modal component (Today and Project workspace each have their own independent copy, `taskModalOpen`/`editingTaskId` duplicated in both), so this reuses one of the two real ones rather than building a third.
  - **Projects & Work Log rows** -- `nav.onOpenProject(project_id)`, same callback.
  - **Journal row** -- `nav.onOpenNotebook()` opens the existing Notebook overlay.
  - **Sleep / Workout / Checklist rows -- read-only, no drill-down (changed 2026-07-29, see fix pass below).** The inline editors described in the original build below were removed entirely after live-testing feedback: Calendar shows what happened, it is never where you change it. Checklist specifically has no drill-down at all either -- `checklist.js` is hardcoded to `todayKey()`, same "no arbitrary-date screen exists" gap Sleep/Workout had, so a fake drill-down would only work for today and silently misbehave every other day. A real dated Checklist view is a deliberate, acknowledged follow-up, not built yet.
- `Deploy/js/main.js` -- `calendarPage` imported + registered. `Deploy/index.html` -- third tab button, `<template x-if="tab==='calendar'">` block.
- `Deploy/css/components.css` -- ~90 new lines, `.calendar-page`/`.filter-chip`/`.range-chip`/`.cal-*`/`.dd-*`, every color a `tokens.css` variable, radii matching existing literal values (8-10px).
- `Deploy/service-worker.js` -- `calendar.js` and `pendingNav.js` added to `ASSETS_TO_CACHE`, cache bumped `v64` → `v65`.

### Calendar + AI fix pass (live 2026-07-29, after first round of live testing)

Abhishek tested the shipped Calendar + AI history fix live and reported 10 issues across both. All root-caused against the actual code before any fix (per CLAUDE.md's plan-before-code rule), confirmed via a debug pass, then implemented in one go:

- **AI: bare health-topic questions got no data (root cause of the "[Insert Sleep Duration Here]" placeholder reply).** Confirmed no such literal string exists anywhere in the codebase -- it was the local Gemma4 model hallucinating a fill-in-the-blank when it had zero sleep facts. Root cause: `_detectHistoryRange()` only matched explicit range language ("last N days," "yesterday," "this/last week," etc.) -- a plain "check my sleep data" with no range words matched nothing and fell through to `explain_day`, which carries zero health fields by design (since `buildExplainHealth()` was removed in the prior session). Fixed with a fallback branch in `_detectHistoryRange()` (`aiPanel.js`) matching bare sleep/workout/health topic words, defaulting to the same last-14-days window the "Health check-in" quick action already uses.
- **AI: TTS read markdown symbols aloud.** `_speak()` (`aiPanel.js`) only stripped `[System:...]` tags, trailing em-dash text, and URLs. Added strips for `**bold**`, `*italic*`, `` `code` ``, `_underscore_`, `#` headers, and leading bullet markers before sending text to the Cloud TTS proxy.
- **Calendar: year dropdown showed 2024 while data was correctly 2026.** Confirmed `viewYear` itself was always correct (`new Date().getFullYear()` at component creation) -- this was a pure Alpine.js display bug: `<select x-model.number="viewYear">`'s options are populated by a sibling `x-for`, and if the options aren't in the DOM yet at the exact moment Alpine's `x-model` does its initial value-sync, the browser silently falls back to displaying the first option (`cur-2`) and nothing ever re-triggers a re-sync. Fixed with an explicit `:selected="y === viewYear"` on each `<option>` (`index.html`), which resolves per-option directly off the reactive value regardless of directive ordering.
- **Calendar: filter chips gave no visible on/off distinction.** `.filter-chip.on` used a `--surface-2` fill sitting only a few RGB units from the card background (nearly invisible in Paper Studio: `#fdfbf7` on `#f8f6f2`). Switched to the same `--accent-blue-tint-hover` + `--accent-blue` border treatment `.range-chip.on` already used one row below, for a genuinely visible and internally consistent result.
- **Calendar: long cell text overflowed the cell instead of truncating.** Real CSS bug, not cosmetic: `text-overflow: ellipsis` was set on `.cal-line`, the flex row wrapping an icon *and* a text span -- ellipsis has no effect on a flex container clipping a nested child's text, only on the element directly containing the overflowing text. Fixed by moving the truncation rule onto a new `.cal-line-text` span wrapping just the text, with `overflow:hidden`added to `.cal-cell` as a backstop and cell icons bumped 11px → 12px for legibility.
- **Calendar: no dev-mode visibility into what a month load actually queried.** Added a one-line `console.log` at the end of `loadMonth()` (`calendar.js`) -- grid date range + per-category row counts, always on (not gated, nothing sensitive).
- **Calendar: history became fully read-only.** All three inline editors (Sleep/Workout/Checklist -- state, open/close/save methods, and their `index.html` markup) removed outright from `calendar.js`/`index.html`. Rows for these three are now plain facts: no chevron, no hover, no click. `calendar.js`'s own header comment now accurately says "Read-only; no ad-hoc Supabase calls, everything goes through DB.* read methods only" -- confirmed via grep, zero `.save(`/`.setStatus(`/`.undoStatus(` calls remain in the file.
- **Calendar: drill-downs now confirm before leaving.** `openTaskDrillDown`, `openProjectWorkDrillDown`, and `openJournalDrillDown` (`calendar.js`) each `await askConfirm(...)` (the existing shared confirm-dialog component, `isDanger:false` since navigating isn't destructive) before calling into `nav.*`. A new `.dd-row.clickable` CSS modifier (`components.css`) gives only the genuinely interactive rows (Tasks/Projects/Journal/future task-groups) the pointer cursor and hover lift -- the now-read-only Sleep/Workout/Checklist rows plainly don't look clickable.
- **Calendar: future dates collapsed to a glimpse, not a workspace.** New `selectedTaskGroups` getter (`calendar.js`) groups a future date's tasks/reminders by project (or "no project"), counts only. Markup branches on `selectedIsFuture`: past/today shows the real per-item list (click → `openTaskDrillDown`, confirm-gated); future shows one row per group with a "Go to" click (`goToTaskGroup`, also confirm-gated) instead of per-item interactive rows. The Checklist section is now also hidden entirely for future dates (`selectedChecklist.length > 0 && !selectedIsFuture`) -- a "Not logged" status for a day that hasn't happened was nonsensical.
- `Deploy/service-worker.js` cache bumped `v65` → `v66`.

### Calendar day-cell vivid pass (live 2026-07-29)

The first color-hierarchy mockup round (flat `--surface-2` lift / generic accent-tint wash / intensity heatmap) was rejected as too washed-out and too similar across all 3 options. A second round with 3 genuinely distinct structures (Option A: stacked category blocks / Option B: single agenda card with chips / Option C: heatmap) got picked as "A, but still too dull." Root cause named plainly rather than guessed around again: Atlas's 5 accent hex values are themselves muted/desaturated by design (`--accent-sage:#86ab92` etc.) -- they were never going to look like a saturated illustration palette (the Bing Rewards reference Abhishek linked), and inventing brighter tokens isn't allowed. The fix that actually landed: stop using the faint base tint and use the **solid full-strength accent color as a real icon badge**, with the block background on the **existing stronger `-tint-hover` token** instead of the faint base one.

- **`Deploy/js/pages/calendar.js`** -- `_cellLines()` replaced by `_cellBlocks(dateStr)`, returning up to 3 blocks (never more -- each category group collapses to one block, so there's no overflow/"+N more" logic needed anymore) plus a separate `journal` boolean: `{color:'sage', icon, t1, t2}` for Health & Checklist (sleep/workout/checklist all fold into one block since they're all "logged/complete" signals), `{color:'blue', icon, t1, overdueFlag}` for Tasks & Reminders (overdue count rides as a small coral flag inside the block, never its own block -- coral stays a caution accent, not a whole-day color), `{color:'lilac', icon, t1}` for Projects & Work Logs. Journal has no locked-accent home to borrow, so it stays an uncolored small line, same treatment the overdue flag gets. Category filter toggles still gate what feeds into each block's text, same as the old per-line gating.
- **`Deploy/index.html`** -- cell markup rewritten: `.cal-badge` (20px solid-accent circle, icon inside) + `.cal-block-text` (`.cal-t1` bold primary text, `.cal-t2` optional secondary line) per block, `.cal-journal-line` for the uncolored journal indicator.
- **`Deploy/css/components.css`** -- `.cal-block.{sage,blue,lilac}` background = `--accent-X-tint-hover` (24-32%, the app's existing stronger tint, not the faint 14-17% base one that read as washed out). `.cal-badge.{sage,blue,lilac}` background = the **solid** `--accent-X` value, icon color = `var(--surface-1)` -- deliberately not a new "badge ink" token: `--surface-1` is near-black in Charcoal Muse and near-white in Paper Studio, so it reads as a legible icon "cutout" against any of the 5 mid-tone accents in both themes without inventing anything new. `.cal-cell` min-height raised 106px → 130px for the taller block content; today/selected chrome switched from a 1px inset border to a 2px `box-shadow` ring so it stays visible against the now-colorful block backgrounds.
- **Not fully resolved, flagged for a future round with clearer direction from Abhishek:** he explicitly said he's "not 100% satisfied" with this pass but approved shipping it as Phase 1 closes, with more specific visual direction planned for Phase 2. Don't treat this as a fully settled design -- expect another pass.
- `Deploy/service-worker.js` cache bumped `v66` → `v67`.

### Calendar + app live-testing round 3 (live 2026-07-29, Phase 1 close)

Abhishek did a real pass through the deployed app (desktop + mobile) and reported 5 concrete bugs plus a mobile-responsiveness gap, alongside deciding the 4 audit items above. All fixed same day:

- **`Deploy/index.html` filter/range bars restructured into one row** (`.cal-controls-row`) -- the always-open 7-chip category row plus a separate range-preset row read as two cluttered bands. Category filters now live in a closed-by-default dropdown (`.cal-filter-dropdown`/`.cal-filter-menu`, `calendarPage.filterMenuOpen` + `activeCategoryCount` getter in `calendar.js`), all-on by default, toggled via checkboxes. Range-preset chips stay inline on the left.
- **Today vs. selected cell distinguishability fixed** -- both previously rendered the identical 2px blue box-shadow ring (a regression from the vivid pass), making it impossible to tell which cell was which when they differed (e.g. browsing to a different date than today). Today now gets a small solid-badge date number (same badge language the category blocks use); selected keeps the full-cell ring + tint. The two compose cleanly when today is also selected.
- **Busy-day cell overflow fixed** -- `.cal-block` now also has `overflow:hidden` (defense-in-depth alongside `.cal-cell`'s own) so a dense day's block content clips at its own rounded corner instead of visually spilling past the card edge.
- **Calendar mobile responsiveness** -- a real phone screenshot showed the month grid forcing horizontal scroll (7 columns of rich colored blocks can't fit ~45-50px cells on a phone). Below 480px, each block collapses to a small colored dot (badge/text/flag hidden via CSS) -- still shows which categories are active per day without needing text-width room; full detail is always one tap away in Day Detail, which already stacks to one column below 720px. Today.js's own mobile layout (also shown broken in a screenshot) was **not** touched this pass -- flagged as a separate, not-yet-scoped issue, different page/component.
- **`project-workspace.js`'s "Running now" section fixed** -- `runningTask` (singular, `.find()`) only ever showed the first in-progress task even when multiple tasks were genuinely in progress simultaneously (confirmed live: 2 tasks tagged "In progress" in the Tasks list, only 1 shown above). Now `runningTasks` (plural, `.filter()`), one Insight Pill per running task in a `.running-now-list`, each showing the same 4-tier hierarchy the Tasks list below already uses (status label "Running now" / kind tag "Task"/"Reminder" / task name / running note).
- **Workout day-level summary fields (`workout_score`/`calories`/`vo2_max`) got a manual edit form** -- these are real `atlas_workout_logs` columns already read/displayed (`workoutSummary`/`hasWorkoutData` in `today.js`) and already nulled by the day-type reset, but had **no manual edit path anywhere in the app** until now -- the only prior writers were the reset-to-null patch or the AI's deferred write flow. Added `workoutDetailsForm` + `saveWorkoutDetails()` to `today.js`, a small field row inserted at the top of the existing Workout Sessions modal (`index.html`), no schema change (columns already existed).
- `Deploy/service-worker.js` cache bumped `v67` → `v68`.

**What's deliberately scoped out of this pass:** full per-session workout editing (add/edit/delete individual sessions) from Calendar -- the inline Workout editor covers day-level fields only (day type, duration, type, score, calories, VO2 max, note); Today's own session sub-flow is unchanged and still the place for that. Calendar's month navigation (`prevMonth`/`nextMonth`/`goToToday`/year select) all reload via the same true range methods, so browsing arbitrarily far into the past or future works uniformly -- no special-casing needed since a future window just returns empty for the log tables while still returning real rows for scheduled tasks.

---

## Atlas AI voice output — Google Cloud TTS (live 2026-07-29)

Real cloud voices, replacing browser `SpeechSynthesis` for the two "Atlas" voice options. Frontend UI (Settings voice picker, Play/Stop/spinner on assistant messages) was built by Gemini across commits `e878665`/`467af06`/`3e8de45`/`60b5dd2`. First pass (below) fixed the server 500s; second pass (further below) removed client truncation for hands-free full-reply reading.
- **Root cause #1 (confirmed):** the Google TTS request hardcoded `languageCode: 'en-US'` for every voice, but `atlas_calm` maps to an `en-IN-*` voice — a locale mismatch Google's API rejects. Fixed with a proper `{name, languageCode}` map per voice profile.
- **Root cause #2 (high-confidence fix, not provable without stderr access):** every single invocation was returning 500 regardless of voice (confirmed via live Supabase edge-function logs — 100% failure rate before this fix), pointing to a shared failure point common to both voices, not just the mismatched one. The function used the `npm:google-auth-library` SDK for Google Cloud auth — a heavy, Node-oriented dependency chain known to be fragile in Supabase's Deno Edge runtime. Replaced with a hand-rolled signed-JWT → OAuth2 token exchange using only Deno's native Web Crypto API and `fetch`, removing the dependency entirely. This is the standard working pattern for this exact scenario and is strictly safer regardless of whether it was literally the prior failure.
- **Voices:** `atlas_calm` → `en-IN-Neural2-B` (male, Indian English) with `languageCode: 'en-IN'`. `atlas_clear` → `en-US-Neural2-D` (male, global English, swapped from the previous `en-US-Journey-D` — Journey is a newer preview-tier voice family with narrower availability; Neural2 is Google's standard broadly-available tier).
- **Hands-free full-reply reading (2026-07-29, second pass):** Abhishek wants to talk to Atlas hands-free and have it read the whole reply, not just the first ~900 characters. Client-side truncation in `_speak()` (`aiPanel.js`) removed entirely -- the full cleaned message is now always sent to the Edge Function. Server-side `MAX_CHARS` raised `1,000` → `3,000` (safely under Google TTS's own ~5,000-char input ceiling on the synchronous endpoint) and the behavior on overflow changed from a hard 400 rejection to **server-side truncation at the last sentence boundary within the limit** -- a very long reply still gets mostly spoken instead of nothing at all. The server reports whether it truncated via an `X-Voice-Truncated` response header (with a matching `Access-Control-Expose-Headers` CORS entry so the browser's `fetch()` can actually read it) -- the client sets `msg.voiceTruncated` from that header after the response comes back, not from a client-side guess. Hint text updated to "✂ Voice plays only part of this very long reply." (`index.html`). In normal use (most assistant replies are well under 3,000 characters) the hint never shows and Atlas reads the entire response.
- Deployed via the Supabase MCP tools directly (`atlas-tts-proxy`, now version 4, `verify_jwt: false` preserved — the function does its own custom JWT check inside the handler, so gateway-level verification staying off is intentional, not an oversight).
- `Deploy/service-worker.js` cache bumped to `v63`.

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
- **Hover fixed + dropdown removed (2026-07-29):** the sparkline hover tooltip never worked -- root cause was `.health-spark-hitboxes`/`.health-spark-hitbox` (`position:absolute`) had no positioned ancestor anywhere up the DOM (`.health-spark`, `.health-trend`, `.health-panel`, `.card` all lacked `position:relative`), so the invisible hitbox layer anchored to the page root instead of the chart. Fixed by adding `position: relative` to `.health-spark` and `.health-spark-hitbox`. The 14/30-day `<select>` dropdown (`sleepSparklineDays` in `today.js`) is removed -- it wasn't wired to a real bug, but per Abhishek's own stated preference for a simple reliable trend over a fiddly option, the Sleep trend is now locked to a static 14-day window (plain `<span>` label, matching Workout's static caption).

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
- **Tooltip hover fixed (2026-07-29):** same missing-`position:relative` bug as Sleep's hitboxes -- `.health-tooltip` inside a `.health-week-cell` had no positioned ancestor, so it anchored to the page root instead of the cell, landing correctly or incorrectly depending on scroll/page height at hover time. Fixed by adding `position: relative` to `.health-week-cell`. The aggregation/tooltip strings themselves (`workoutWeekAggregate`, the "N session(s)"/Met-Partial-Missed text) were already correct -- a reported "unidentified session" label does not exist anywhere in current source (confirmed via full-repo grep) and was almost certainly a stale cached JS bundle from before the SW fix below, not a code defect.
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
- **Five total voice-write flows now shipped (as of 2026-07-28 final bundle):** Log workout, Log sleep (Phase 1), plus task completion (`complete_task`), checklist/routine marking (`mark_checklist`), and daily journal reflection (`journal_reflection`). All five use the same propose-confirm-write loop. `complete_task` and `mark_checklist` resolve names/numbers client-side (conservative exact-match only) before showing the confirm card; any ambiguous/unresolvable input shows a prose clarification with the numbered list, never a partial write.
- **Health panel delete (as of 2026-07-28):** both Sleep and Workout panels now have a trash icon in the header (`deleteWorkoutEntry()` / `deleteSleepEntry()` in `today.js`), `askConfirm()` + 8s undo toast with restore callback. Visible only when an entry exists for today.
- **What's NOT done yet**: the `atlas-ai` Edge Function itself (Cloud provider will show "unavailable" until this is deployed with a real secret); per-view Fact Package binding (badge was cut, so it's always `explain_day` right now).

### AI Action Layer — FAILED / DEFERRED (final verdict 2026-07-28)

> **Future agents: read this section before touching anything in `ui/aiPanel.js`, `features/aiContext.js`, or `features/aiConfig.js` related to write flows. The write-flow layer is not a live feature.**

**What exists in code:**
Six write flows are implemented in `aiContext.js` (`WRITE_FLOWS`) and routed through `aiPanel.js`: `log_workout`, `log_sleep`, `complete_task`, `mark_checklist`, `journal_reflection`, `save_ai_memory`. The architecture as of the last attempt (commit `c13a0ab`) uses a two-call extraction model — one parallel prose call and one extraction-only call — plus client-side phrase detection for AI Memory (Track A, bypasses the model entirely).

**What happened in real use:**
The write flows were attempted across at least four separate fix/rebuild rounds (roughly 2026-07-28 to 2026-07-28). Each round fixed specific bugs but introduced or uncovered new ones. The final round (two-call architecture) still showed:
- Workout confirm card appeared but VO2 max was missing from the saved entry.
- Task-related flows were confusing: ambiguous number interpretation (task numbering vs. quick-action wording) led to unexpected task selection. Abhishek found this potentially unsafe and stopped testing.
- Reliable JSON extraction is inconsistent across providers and prompt phrasings.
- The interaction model (dictate → wait → confirm card → tap) is fragile when any step in the chain fails silently.

**Abhishek's verdict (2026-07-28):** "I give up. I will not test this again. I will use manual editing. The AI action layer is a failed experiment."

**Current status:**
- AI panel conversation, persona/PIN, hybrid routing, and Memory Notebook (Pin/Save Session/Compact): **working**.
- All six write flows: **do not treat as live features**. They are implemented in code but not reliable in practice. All data writes must be done through the existing manual UI (sleep card Edit, workout card Edit, task modal, checklist Log buttons, journal toggle, Notebook overlay).
- The code is left in place — removing it would be churn with no gain. But no agent should demo it, rely on it, or patch it without being explicitly asked to do a full rewrite.

**What a future rewrite would need to address:**
- The confirm-card interaction model may not be the right fit for mobile voice use. The two-tap flow (dictate → tap Confirm) works mechanically but fails under real latency + voice-to-text imprecision.
- JSON extraction reliability requires either a dedicated extraction model (not shared with conversation), or a fundamentally different approach (e.g. structured outputs / function calling via a capable API, not Ollama).
- Task-number/name resolution is inherently ambiguous when the user is dictating quickly. This needs an unambiguous UI affordance, not a text-parsing guess.
- Any future attempt should be scoped as a standalone project, mockup-reviewed, and live-tested incrementally — not patched on top of the current architecture.

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

**"Split-brain" cache gap closed (2026-07-29).** The v55→v56 bump ("Fix split-brain cache") only bumped the version number — it didn't change behavior. Root cause: the navigation handler's `fetch(event.request)` was a plain fetch with no cache option, so "network-first" could still be silently satisfied by the **browser's own HTTP cache** (separate from the SW's Cache API) instead of a real network round-trip, if the host's response headers allowed it. Fixed: `fetch(event.request, { cache: 'no-store' })` on the navigation branch forces a genuine network hit every time, falling back to the cached shell only on an actual network failure. `CACHE_NAME` bumped to `v57`.

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
- **[SHIPPED 2026-07-29] Calendar page** -- full-page "Calendar" tab (Today/Projects/Calendar), past + future, live. See "Atlas Calendar" section above for the full build. The Upcoming modal is untouched and still exists alongside it (not replaced) -- Calendar is the fuller past+future view, Upcoming stays the quick "what's coming up" glance from Today's own Tasks card.
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

### AI layer -- action layer FAILED / DEFERRED; conversation panel is live
- The `atlas-ai` Supabase Edge Function itself (Cloud provider needs this + a real Vertex/Gemini secret before it stops showing "unavailable"). Still open if Cloud AI is ever revisited.
- **All 6 write flows exist in code but are not live features** — see "AI Action Layer — FAILED / DEFERRED" subsection under LIVE. Do not treat them as something to patch; treat them as a future rewrite project.
- Per-view Fact Package binding (a context badge showing "About: Project X" etc. -- cut from the Phase 1 UI to de-clutter the header; every message currently carries `explain_day` as ambient context regardless of which page the panel was opened from).
- **Voice output mode (text-to-speech):** shipped 2026-07-28 using browser `SpeechSynthesis` with a voice picker in Settings. Works, but quality is inconsistent -- browser voices vary in speed and naturalness even with Microsoft neural voices. Abhishek has a soundbar and wants a properly high-quality voice. **Next step:** replace SpeechSynthesis with a real TTS API (ElevenLabs recommended for quality; Google Cloud Neural2/Journey or OpenAI TTS are alternatives). Needs API key management + audio playback (chunked or streamed). The toggle + voice picker UI stays as-is; only the playback back-end changes.
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

**Phase 1 is CLOSED as of 2026-07-29 — see the banner at the top of this file.** Atlas is in a one-week real-data testing phase; Phase 2 starts when Abhishek reopens the conversation next week. The full consolidated Phase 2 backlog lives in the **"📋 Phase 2 backlog"** section at the top of this file — don't duplicate it here, that section is the current source of truth for what's next.

History, for context on how we got here:
- **Phase 5 (Health + Insight Pills)** closed 2026-07-27.
- **Phase 6 (Tasks & Reminders)** substantially closed 2026-07-28 (Gemini starter slice + Claude close-out).
- **Atlas AI Phase 1** (conversation panel, persona/PIN, hybrid routing, memory notebook) shipped 2026-07-29. The write-flow action layer failed real-use testing 2026-07-28 and remains deferred — see "AI Action Layer — FAILED / DEFERRED" below.
- **Calendar page** (full past+future view) shipped 2026-07-29, through 4 live-testing rounds the same day.
- **Google Cloud TTS** shipped 2026-07-29.

Nothing starts without Abhishek re-opening the conversation — that includes everything in the Phase 2 backlog above, even the small-looking items.

---

## Hard reminders

- **Read `CLAUDE.md` before writing code.** The rules live there, and they're non-negotiable without asking.
- **Read the last 2-3 `SESSION_LOG.md` entries** at the start of your session to know what the previous agent shipped and any state that isn't in the codebase yet.
- **Append your own `SESSION_LOG.md` entry at the end** - same format. Don't skip.
- **Commit and push after every completed pass in Atlas.** Do not hand off "waiting to push" - Abhishek can't review from localhost.
- **Local dev = production DB.** Do not sign in and click around locally.
