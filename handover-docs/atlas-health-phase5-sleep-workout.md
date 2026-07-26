# Atlas Health Phase Planning Notes (Phase 5 — Sleep & Workout)

## Purpose

This document captures the agreed direction for Atlas's next major feature area, Health (Sleep + Workout), combining two prior planning threads into one reference file. It replaces the standalone sleep-only notes file. It is meant to be handed to Claude for full planning, and later to Gemini/Antigravity for implementation.

## Where this fits in the roadmap

- Phase 4 (Project Lifecycle & Visual Polish) is closed.
- One item remains parked from Phase 4: the Completed Project card visual design is functionally fine but still feels visually washed out. This is NOT part of Health planning.
- This document defines **Phase 5: Health (Sleep + Workout)** as the next major feature phase.

---

## Part A — Sleep

### Product goal

Atlas sleep should act as a sleep diary + pattern engine, not a medical device dashboard. The goal is to build enough honest daily sleep history that Atlas and its AI layer can connect night behavior, ring metrics, and next-day subjective experience over time.

### Routine context

The user works night shift. Sleep is logged after waking, typically around 1:00–2:00 PM. The system must not assume a conventional midnight-to-morning schedule when handling sleep dates and logical-day boundaries.

### Core sleep record model

| Layer | Source | Purpose |
|---|---|---|
| Ring metrics | Gabit ring screenshot parse | Structured numeric sleep data |
| Morning reflection | Free-flow wake-up note | Human subjective experience |
| Night context | Existing checklist items + notes | Likely causes/influences on sleep |

### Morning capture flow

1. Upload a Gabit ring sleep screenshot.
2. Parse structured sleep metrics into Atlas.
3. Allow manual correction if parsing misses anything.
4. Add a free-flow morning reflection note.

### Morning data fields

- Sleep score
- Total sleep duration
- Goal comparison / sleep debt or surplus
- Sleep start time
- Consistency
- Deep sleep
- REM sleep
- WASO
- HRV
- Heart-rate metrics
- Sleep stage breakdown

Atlas v1 should store parsed fields that are reliably available, not invent unavailable metrics.

### Night context

No duplicate nightly form. Atlas should reference:
- Checklist items: late-night junk food, medicine timing, sleep time
- Night notes

### Ingestion priority

| Priority | Method | Status |
|---|---|---|
| 1 | Direct Gabit ring integration | Desirable but uncertain; treat as investigation only |
| 2 | Screenshot upload + in-app parsing | Primary Atlas v1 path |
| 3 | Manual correction after parse | Backup path |

### Trend priorities

1. Sleep duration trend
2. Deep sleep and REM trend
3. AI pattern observations

### AI behavior rules for sleep

- Reflective coach, not rigid judge
- No conclusions from 1–2 nights
- Pattern observations should wait until enough entries exist
- Phrase observations as discussion points, not verdicts

### Sleep v1 structure

**Capture:** screenshot upload → parsed metrics review → correction if needed → morning free note  
**Context:** relevant night checklist signals + night notes  
**Review:** sleep history timeline, 7-day and 30-day duration trend, deep/REM trend, AI pattern observation panel

### Sleep boundaries

- No public Gabit API assumed
- No medical-grade interpretation layer
- No forced subjective rating dropdowns
- No duplicate night logging already present in checklist/notes

---

## Part B — Workout

### Product goal

The user does not need motivation for strength training. The goal is a smart tracking + strict fitness coach system that:
- Tracks whether training supports bone density and muscle mass goals
- Connects workout patterns with sleep patterns
- Gives diet/food guidance tied to training load

### Current weekly reality

- 4–5 days/week: strength training (Cult.fit, at home, dumbbells 5–15 kg)
- 1 day/week: active recovery via cleaning
- 1 day/week: active recovery via playing with kids

### Desired weekly structure

- 4–5 days/week: strength training — already achieved
- Every day: active play/walk with kids, 30–60 minutes
- 1 day/week: cleaning/chore-based active recovery
- 1–2 days/week: proper yoga/stretching — biggest current gap

### Workout data model

**Per-day fields:**
- Workout type(s): Strength / Cardio-Walk / Yoga-Stretch / Active Recovery
- Duration
- Intensity for strength sessions
- Program structure tag: upper / lower / push / pull / legs / full body
- Free notes

**Per-week rollup:**
- Actual vs target: strength days, cleaning day, yoga/stretch days, daily active play
- Multi-week consistency streaks by category

### Relationship to sleep

The AI coach should be able to connect workout patterns with sleep patterns, for example:
- Heavy strength days + good sleep
- Skipped stretching weeks + shorter sleep/fatigue
- Missing daily active play + lower sleep scores

### AI coach behavior for workout

- Strict but constructive
- Focus on the gaps: stretching/yoga and daily active play
- Do not waste effort motivating strength training
- Diet/food suggestions can start qualitatively in v1, not full macro tracking

### Workout v1 structure

**Capture:** daily workout type + duration + intensity/program tag + free notes  
**Review:** weekly structure view, actual vs target, multi-week consistency  
**AI layer:** cross-reference sleep and workout patterns for coaching observations

### Workout boundaries

- No gamified motivation layer needed for strength training
- No full nutrition tracking system in v1
- Different workout types must remain distinct, not treated as one flat “worked out” count

---

## Cross-cutting notes

- Both features should integrate with existing Atlas checklist and notes instead of duplicating data entry.
- Both should support the user’s night-shift routine and logical-day handling.
- The AI layer should be pattern-aware, thoughtful, and not reactive after one day.
- This phase remains planning-only until a reviewed implementation plan is approved.