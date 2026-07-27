# Sleep data — current state and roadmap

**Status:** planning-only, no code shipped. Deliberately deferred by Abhishek 2026-07-26 as part of Design Review Round 2 — the Workout side of that same round got a day-type toggle and shipped; Sleep got this doc instead.

**Owner:** Abhishek. Nothing here is committed to a build phase until he re-opens the conversation and green-lights a specific piece.

---

## Where sleep data lives now

Every manually-logged sleep entry is one row in `atlas_sleep_logs`, keyed by `entry_date UNIQUE` — one row per calendar day (midnight-based, not 6am-shifted per the locked date-rule split in `CLAUDE.md`).

Columns currently in use:
- `duration_minutes`
- `sleep_score` (0–100)
- `deep_minutes`
- `rem_minutes`
- `resting_hr`
- `hrv`
- `note` (free text)

Reserved for the future AI parser but unused right now: `start_time`, `light_minutes`, `awake_minutes`.

Rows soft-delete via the standard `atlas_sleep_logs_soft_delete` / `_restore_trash` RPCs and are recoverable from the Restore view like every other entity.

**There is currently no read path that groups these across days.** The Today card only reads today's row. If Abhishek has been logging sleep every day for the last 30 days, there is nothing in the UI that shows those 30 days as a trend — the data exists, it just isn't surfaced.

---

## Near-term roll-up (Phase 3-ish · not yet approved)

A weekly / monthly trend view, structurally the same as the Checklist Completion bar chart at the bottom of Today. Renders last 30 days of sleep score + duration as stacked bars — or a small line chart if the score is the single dimension worth showing.

**Implementation shape:**
- Reads `atlas_sleep_logs` directly, filters `entry_date` between now-29 and now, groups by day. Same client-side aggregation pattern as `today.js:loadTrend()` — the checklist trend already does this.
- No new table, no schema change, no new DB method needed (`DB.Sleep.listRecent(30)` already exists in `db.js`).

**UI placement — decision deferred to build time:**
1. **Inline under Sleep on the Today card** — a "Last 30 days →" affordance that expands a mini-chart into the existing Sleep card. Simplest.
2. **Dedicated Sleep tab under the vitals column** — like the Workout/Sleep already split, add a third "History" surface. Bigger footprint.
3. **A separate History page opened from the header** — matches how Notebook / Restore already work as overlays. Room for both sleep and workout trends in one place.

Recommend option 3 if this ever ships, because workout will want the same treatment eventually and one shared History overlay avoids two separate implementations.

---

## AI-driven insights (further out · two independently-approvable pieces)

### 1. Screenshot parser
The already-planned path: upload a ring / sleep-app screenshot, a Supabase Edge Function calls Vertex AI (Gemini) using the existing `VERTEX_API_KEY_POS` secret and the `ai-teacher` edge-function pattern from the old app. Extracts fields, presents them for review before saving. **Draft-only, never a silent write** — matches the AI-layer standing rules on the old app.

- Feasible today; the Vertex integration already exists in the shared Supabase project.
- Not built. Would need: an Edge Function, a small upload UI in the Sleep card, and a review-before-save modal.
- Estimated shape: ~150 lines of Edge Function + ~50 lines of Alpine.
- Same shape works for Workout screenshot parsing (Whoop, Fitbit, etc.). Both would share the parser plumbing.

### 2. Pattern-of-life insights
Weekly summary that correlates sleep with other logged behavior:

> *"Your average sleep score dropped 8 points this week — the four nights it dropped were the nights you logged a workout ending after 10 pm."*

**Requires:**
- 30+ days of consistent data (which the roll-up above unlocks — you can't detect a pattern in 3 data points).
- The same Vertex path as the screenshot parser.
- Correlation between `atlas_sleep_logs` and `atlas_workout_logs` (both by `entry_date`, easy join).

Higher payoff, higher effort. Depends on the roll-up existing first.

**AI tone, carried over from an earlier planning note (folded in 2026-07-29, standalone doc retired — see below):** the AI should work as a reflective coach, not a rigid judge — noticing patterns in metrics/context/morning notes and discussing them carefully over time, not reacting strongly to one or two nights. Pattern suggestions should only surface once enough entries have accumulated to mean something.

---

## What we're deliberately NOT planning

- **Background sync of a ring's data via OAuth** (Fitbit, Whoop, Oura). Adds a whole vendor dependency, breaks the "manual entry only" simplicity, and every vendor's OAuth is its own maintenance burden.
- **Push notifications reminding him to log sleep.** Notifications as a whole category are still deferred; sleep-specific reminders wouldn't be first anyway.
- **Automatic sleep-goal streaks.** Streaks already have a well-defined mechanic (`atlas_targets` with `kind='streak'` + relapse + grace day). Adding sleep as an implicit auto-streak would confuse that model. If Abhishek wants a "consecutive days with sleep score ≥ 80" streak, that's a normal streak he creates like any other — no special auto-mechanic.

---

## Order of operations if / when this becomes a phase

1. **Trend roll-up chart** — small, no schema change, unlocks the visualization.
2. **Screenshot parser** — medium, one Edge Function + a review-before-save modal. Also unlocks Workout screenshot parsing on the same plumbing.
3. **Pattern-of-life insights** — largest, needs both of the above to be useful.

Each stage is independently deployable and independently approvable. If Abhishek stops after stage 1, the trend view is already useful on its own.

---

## History

- **2026-07-26** · Written as the item-4 deliverable of Design Review Round 2. Sleep card unchanged this round (Workout got the day-type toggle, Sleep got this doc). See the Round 2 mockup for the accompanying work.
