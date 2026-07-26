# Phase 5 — Health (Sleep + Workout) · Implementation Plan

**Status:** Planning complete, awaiting approval to start build.  
**Written:** 2026-07-27  
**Depends on:** Phase 4 (Project Lifecycle) closed. Design Review Round 2 shipped.  
**Replaces:** `SLEEP-ROADMAP.md` (which becomes historical context, not the active plan).

---

## Guiding principles

- This is a sleep diary + pattern engine, not a medical dashboard.
- The user works night shift — sleep is logged after waking (~1–2 PM). Never assume conventional schedules.
- Workout tracking serves bone density / muscle mass goals, not motivation. The user already trains 4–5 days/week.
- AI is deferred until enough data exists (30+ days minimum). Nothing in v1 depends on or blocks the AI layer.
- Integrate with existing Atlas data (checklist, notes, journal) — never duplicate entry.
- Respect the midnight-date rule for sleep + workout (not the 6am checklist boundary).

---

## What exists today (baseline)

### Sleep (`atlas_sleep_logs`, migration 007)
- One row per calendar day (`entry_date UNIQUE`, midnight-based)
- Columns: `duration_minutes`, `sleep_score`, `deep_minutes`, `rem_minutes`, `resting_hr`, `hrv`, `note`
- Reserved unused: `start_time`, `light_minutes`, `awake_minutes`
- UI: flat number-input modal, 6-metric grid on the Today card
- DB: `getByDate`, `listRecent(14)`, `save` (upsert), soft-delete + restore

### Workout (`atlas_workout_logs`, migrations 009/011/013)
- One row per calendar day (`entry_date UNIQUE`)
- Columns: `duration_minutes`, `workout_type` (single text), `calories`, `workout_score`, `vo2_max`, `day_type` (`workout`/`active_recovery`/`full_rest`), `note`
- UI: day-type chip toggle on Today card, flat modal for "workout" state
- DB: same pattern as Sleep

Both are manual-entry-only. No trends, no history view, no AI, no screenshot parsing.

---

## v1 scope — what to build

### A. Data model changes

#### New table: `atlas_workout_sessions`

The user's typical day is one primary workout + a walk or play with kids — genuinely two distinct activities with different types and durations. A child table is the correct model.

```sql
CREATE TABLE atlas_workout_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_log_id UUID NOT NULL REFERENCES atlas_workout_logs(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL
        CHECK (activity_type IN ('strength', 'cardio_walk', 'yoga_stretch', 'active_play', 'cleaning')),
    duration_minutes INTEGER,
    intensity TEXT
        CHECK (intensity IS NULL OR intensity IN ('light', 'moderate', 'hard')),
    program_tag TEXT
        CHECK (program_tag IS NULL OR program_tag IN ('upper', 'lower', 'push', 'pull', 'legs', 'full_body')),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE atlas_workout_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON atlas_workout_sessions
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

- `intensity` and `program_tag` are only meaningful for strength sessions. Nullable, UI hides them for other types.
- CASCADE delete: when the parent workout log is hard-deleted from Restore, sessions go with it.
- No `deleted_at` on sessions — they live/die with their parent log. Simplifies everything.
- No `updated_at` — sessions are write-once (delete + re-add to "edit").

#### New table: `atlas_workout_targets`

Weekly targets — how many days per week each activity type should happen.

```sql
CREATE TABLE atlas_workout_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_type TEXT NOT NULL UNIQUE
        CHECK (activity_type IN ('strength', 'cardio_walk', 'yoga_stretch', 'active_play', 'cleaning')),
    target_days_per_week INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE atlas_workout_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON atlas_workout_targets
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON atlas_workout_targets
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
```

Seed values (inserted via migration or on first use):
| activity_type | target_days_per_week | note |
|---|---|---|
| strength | 4 | Cult.fit / home / dumbbells |
| active_play | 7 | Walk or play with kids, 30–60 min |
| yoga_stretch | 2 | Biggest current gap |
| cleaning | 1 | Active recovery day |

#### Sleep schema additions

```sql
ALTER TABLE atlas_sleep_logs ADD COLUMN morning_note TEXT;
```

- `morning_note`: the subjective morning reflection ("how do I feel, what do I remember"). Distinct from `note` which stays as an optional contextual/technical note.
- No new table for sleep goals — use a single row in `atlas_workout_targets`-style table or simpler: add a `sleep_goal_minutes` column to a shared `atlas_health_settings` table (single row, upsert pattern):

```sql
CREATE TABLE atlas_health_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sleep_goal_minutes INTEGER DEFAULT 420,  -- 7 hours default
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE atlas_health_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON atlas_health_settings
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON atlas_health_settings
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
```

Single-row table — one settings record for the single user. Contains the sleep duration target (used for debt/surplus calculation in the trend view).

---

### B. UX structure

#### Sleep capture redesign

Replace the current flat modal with a **two-step modal**:

**Step 1 — Metrics:**
- Duration (hours + minutes, same as now)
- Sleep score (0–100)
- Start time (currently in schema but never surfaced — add it)
- Deep sleep (minutes)
- REM sleep (minutes)
- Resting HR
- HRV
- Layout: ordered to match a Gabit screenshot top-to-bottom for easy manual transcription

**Step 2 — Morning reflection:**
- A generous `<textarea>` for `morning_note`
- Prompt text: "How did you sleep? How do you feel?" (placeholder, not a label)
- Optional — can skip straight to Save

**The general `note` field** stays available as a small collapsible "Add context note" at the bottom of step 1 (for things like "took melatonin", "noisy neighbors", "late screen time"). Most days it'll be empty.

**Night context cross-reference:** DEFERRED. The user confirmed this needs actual cross-reference data to accumulate before making a design decision. Not in v1. When it ships later, it will show relevant Sleep-block checklist items from the previous night as read-only context alongside the metrics step.

#### Workout capture redesign

**Day-type toggle stays as-is** (already shipped, working, liked).

**For "workout" days — session-based logging:**

The current single flat form becomes a **session list**:

- Each session row shows: activity type icon/label + duration + (intensity badge if strength)
- "+ Add session" button adds a new session form inline or in a small sub-modal
- Session form fields:
  - Activity type: segmented control or select (`strength` / `cardio_walk` / `yoga_stretch` / `active_play` / `cleaning`)
  - Duration (minutes)
  - Intensity: only shows for strength (`light` / `moderate` / `hard`)
  - Program tag: only shows for strength (`upper` / `lower` / `push` / `pull` / `legs` / `full_body`)
  - Note (optional, one line)
- Tap an existing session row to edit; swipe/delete to remove

**For "active recovery" / "full rest" days:**
- Keep the current one-tap-and-done animations
- Optionally: a small "+ Log activity" affordance if they want to record what the recovery was (e.g. "cleaning, 45 min") — same session form, just pre-set to the matching type

**Weekly targets settings panel:**
- A small gear icon or "Targets" link inside the Workout card header
- Opens a compact inline panel (not a full modal) showing each activity type with an editable number (days/week)
- Rarely used — set once, adjust occasionally

#### Workout weekly view

A new section **below the workout card** (or below the full 60/40 row — see "Trend chart placement" below):

- **Activity type rows**, each showing:
  - Type label + icon
  - 7 day-dots for the current week (M T W T F S S): sage = logged, hollow = not yet, coral = day passed without logging (only if behind target)
  - Fraction: "3 / 4 days" (actual / target)
- **Multi-week consistency**: a compact 4-week grid per type (4 dots per row, sage = met target that week, coral = missed). Shows the "are you building the habit" signal.

#### Sleep trend chart

- 30 days of data, same visual language as the Checklist Completion trend
- Bar chart: daily sleep duration as bar height, color-coded by score:
  - sage: score ≥ 80 (good)
  - muted/default: score 60–79 (okay)
  - coral: score < 60 (poor)
- Horizontal target line if `sleep_goal_minutes` is set
- Running 7-day average as a subtle stepped overlay line
- Hover/tap shows the day's detail (date, duration, score)
- Below the chart: "Avg 6h 42m · Best 8h 10m · Debt −2h 18m this week" summary line

#### Workout trend/consistency chart

- 30 days, grouped by activity type
- Stacked or side-by-side representation showing which types happened each day
- Or simpler: a row-per-type dot grid (same as the weekly view, but spanning 30 days instead of 7)
- Summary: "Strength 18/20 days · Yoga 4/8 days · Active play 22/30 days"

#### Trend chart placement on the Today dashboard

**Below the 60/40 row, full width.** Same structural position as the Checklist Completion trend chart already occupies (below the Routine section). Layout:

```
[Hero band — streaks + KPIs]
[Tasks 60% | Sleep+Workout 40%]    ← existing, unchanged
[Routine — checklist]               ← existing, unchanged
[Checklist Completion trend]        ← existing
[Health trends — Sleep + Workout]   ← NEW, full width
```

Both sleep and workout trends sit in a single "Health" section with two tab-like toggles (Sleep · Workout) or side-by-side cards if space allows. Full-width gives 30-day charts room to breathe. This mirrors the Checklist Completion pattern — data surfaces below its card, not crammed inside it.

If the page feels too long after this ships, we revisit layout (the "charts take the left 60%" option stays available as a future restructure). Ship the simpler additive approach first.

---

### C. DB method additions (`db.js`)

New sections needed:

```
DB.WorkoutSessions: {
    listForLog(workoutLogId)       — all sessions for a given day's log
    listForDateRange(start, end)   — for trend/weekly queries
    create(workoutLogId, session)  — verified insert
    update(id, patch)              — verified update
    remove(id)                     — hard delete (child of soft-deletable parent)
}

DB.WorkoutTargets: {
    list()                         — all targets (small fixed set)
    upsert(activityType, patch)    — create or update a target
}

DB.HealthSettings: {
    get()                          — single row, maybeSingle
    save(patch)                    — upsert the single row
}
```

Sleep and Workout existing methods are sufficient — `listRecent(30)` already supports the trend chart.

---

### D. What is explicitly NOT in v1

| Item | Status | Blocker |
|------|--------|---------|
| Screenshot upload + AI parse (sleep or workout) | Deferred to v1.5 | Needs Edge Function + Vertex, separate design conversation |
| AI pattern observations | Deferred to v2 | Needs 30+ days of data |
| AI workout coaching (gaps, diet) | Deferred to v2 | Needs data + separate prompt design |
| Sleep-workout cross-correlation | Deferred to v2 | Needs both trends populated |
| Direct Gabit ring API | Deferred indefinitely | Vendor dependency, uncertain feasibility |
| Full nutrition/macro tracking | Out of scope | Separate phase entirely |
| Night context cross-reference in sleep modal | Deferred | User wants to see real data first before deciding design |
| Journal note cross-reference | Deferred | Same — needs data to exist |
| Sleep goal streaks (auto) | Not planned | Would conflate with existing manual streak mechanic |
| Push notifications for logging | Not planned | Notification category still deferred |

---

### E. AI behavior rules (for when it eventually ships)

Locked here for reference when AI phases open:

1. **Minimum data thresholds.** 14 days before any sleep pattern observation. 21 days before any sleep↔workout correlation. No exceptions for "interesting" early data.
2. **Tone split.** Sleep = reflective coach ("I notice...", "Have you considered..."). Workout = strict coach ("You haven't done yoga in 2 weeks — your target is 2/week").
3. **Draft-only.** Any AI-generated observation or suggestion is presented for review. Never a silent write. Never a silent field-fill.
4. **Focus on gaps.** For workout: stretching/yoga and daily active play are the coaching targets. Strength training never gets motivational commentary — it's already happening.
5. **Diet is qualitative.** "Heavy strength days might benefit from more protein" — never macro counts or meal plans in v1.
6. **Only reference logged data.** If the user hasn't logged sleep, the AI doesn't mention sleep. No nagging for data that isn't there.
7. **Phrasing.** Observations are discussion points, not verdicts. "Your sleep score averaged 12 points higher on weeks where you did yoga at least once" — not "You need to do yoga to sleep better."

---

## Implementation order

Each step is independently deployable. Each gets its own commit, push, and live verification.

```
Step 1 — Schema migrations
         New migration(s): workout_sessions, workout_targets, health_settings, sleep morning_note
         Apply via Supabase MCP
         Update SCHEMA.md

Step 2 — DB methods
         Add WorkoutSessions, WorkoutTargets, HealthSettings sections to db.js
         Verified writes throughout
         No UI yet — just the data layer

Step 3 — Workout capture redesign
         Multi-session modal replaces flat form
         Session CRUD wired to DB.WorkoutSessions
         Day-type integration preserved
         Active recovery/full rest: optional "+ Log activity" affordance

Step 4 — Workout weekly targets
         Settings panel inside workout card (gear icon → inline panel)
         Seed default targets on first open if table is empty
         Weekly actual-vs-target view (7-day dot grid per type + fraction)

Step 5 — Sleep capture redesign
         Two-step modal (metrics → morning reflection)
         Surface start_time field
         morning_note saved to new column
         Sleep goal setting (small inline affordance, saves to health_settings)

Step 6 — Sleep trend chart
         30-day bar chart below the 60/40 row
         Score-based coloring, target line, 7-day average
         Summary stats line

Step 7 — Workout trend / multi-week consistency
         30-day dot grid per activity type
         4-week consistency mini-grid
         Summary stats line
         Tab or toggle to switch between Sleep and Workout trends
```

**Why this order:**
- Steps 1–2 are non-visual, no risk, unblock everything.
- Workout capture (3) ships first because it has the bigger schema change (child table) — verify the relational pattern end-to-end before sleep.
- Weekly targets (4) ships right after so there's immediate payoff to logging typed sessions.
- Sleep capture (5) is mostly a UI rework over existing schema — lower risk.
- Trends (6–7) come last because they need accumulated data to be meaningful. Getting the capture improvements live sooner means data starts accumulating sooner.

**Design review process:**
- Steps 3, 4, 5 each need a mockup before build (they have real visual/layout weight).
- Steps 6 and 7 (charts) definitely need a mockup — chart design is a layout decision.
- Steps 1–2 are pure data, no mockup needed.
- Mockups can be batched: one artifact covering steps 3+4 (workout), one covering step 5 (sleep capture), one covering steps 6+7 (trends).

---

## Estimated migration count

Currently at migration 013. This phase will add:
- 014: `atlas_workout_sessions` + `atlas_workout_targets` + `atlas_health_settings`
- 015: `ALTER TABLE atlas_sleep_logs ADD COLUMN morning_note TEXT`

Two migrations total. Could be one if we batch, but separating keeps each atomic and reversible.

---

## Restore view impact

- `atlas_workout_sessions`: no Restore entry needed (CASCADE deletes with parent, no independent soft-delete).
- `atlas_workout_targets`: no Restore entry needed (config data, not user content worth recovering).
- `atlas_health_settings`: no Restore entry needed (single settings row).
- `atlas_sleep_logs` and `atlas_workout_logs`: already in Restore. No change.

---

## Risk and rollback

- Every step is additive — no existing behavior removed.
- The workout sessions child table is the only structural risk. If the relational pattern doesn't feel right in practice, we can flatten back to a JSONB `sessions` column on `atlas_workout_logs` without data loss (migrate rows → JSON, drop child table).
- Sleep trend chart is pure read — if it looks wrong or the data isn't useful yet, hide it behind a feature flag (or just don't render when <7 days of data exist).
- Nothing in v1 touches the AI layer, Edge Functions, or external services. It's all local Supabase reads/writes + frontend rendering.
