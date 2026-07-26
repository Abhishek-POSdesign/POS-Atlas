# Atlas Sleep Planning Notes

## Purpose

This document captures the current agreed direction for the Atlas sleep feature so it can be reused later without depending on chat memory.

## Product goal

Atlas sleep should act as a **sleep diary + pattern engine**, not a medical device dashboard. The goal is to build enough honest daily sleep history that Atlas and its AI layer can connect night behavior, ring metrics, and next-day subjective experience over time.[cite:124][cite:125]

## User routine context

The sleep flow must support a night-shift routine. Sleep is typically logged after waking, around 1:00–2:00 PM, so the system must not assume a conventional midnight-to-morning schedule.[conversation_history:1]

## Core sleep model

The agreed sleep record has three layers:

| Layer | Source | Purpose |
|---|---|---|
| Ring metrics | Gabit ring screenshot parse | Structured numeric sleep data |
| Morning reflection | Free-flow wake-up note | Human subjective experience |
| Night context | Existing checklist items + notes | Likely causes and influences on sleep |

This structure is designed to let Atlas compare what happened before sleep, what the ring measured, and how the sleep actually felt.[cite:124][cite:125]

## Morning capture

Morning entry is the primary logging moment. The preferred flow is:

1. Upload a Gabit ring sleep screenshot.
2. Parse structured sleep metrics into Atlas.
3. Allow manual correction if parsing misses anything.
4. Add a free-flow morning reflection note.

The morning note should remain unstructured. It should not force fixed labels like bad/okay/good, because the ring already provides the structured numerics and the user wants the AI to interpret the nuance in free text.[conversation_history:2]

## Morning data fields

The ring screenshot may provide fields such as:

- Sleep score
- Total sleep duration
- Goal comparison / sleep debt or surplus
- Sleep start time
- Consistency
- Deep sleep
- REM sleep
- WASO (wake after sleep onset)
- HRV
- Heart-rate metrics
- Sleep stage breakdown

Atlas v1 should store the parsed structured fields that are reliably available, rather than inventing unavailable metrics.

## Night context

Atlas should avoid duplicate nightly data entry. Instead of creating a separate heavy sleep-night form, it should refer to existing sources already used in the system:

- Checklist items such as late-night junk food, medicine timing, and sleep time
- Night notes

This keeps the sleep feature integrated with the wider POS system rather than turning it into an isolated health app.

## Ingestion priority

The preferred ingestion order is:

| Priority | Method | Decision |
|---|---|---|
| 1 | Direct Gabit ring integration | Best outcome if realistically possible, but currently uncertain |
| 2 | Screenshot upload + in-app parsing | Primary Atlas v1 path |
| 3 | Manual correction after parse | Backup path |

Because direct Gabit integration may not be available, planning should assume screenshot-based ingestion for v1 and treat direct sync as an investigation track rather than a dependency.

## Trend priorities

The first three important trend outputs are:

1. Sleep duration trend
2. Deep sleep and REM trend
3. AI pattern observations

This means Atlas sleep v1 should emphasize a clean history and trend surface over an oversized analytics dashboard.

## AI role

The AI should work as a reflective coach, not a rigid judge. It should use repeated sleep metrics, night-context signals, and morning notes to notice patterns and discuss them carefully over time.[cite:124][cite:125]

A reasonable behavior rule is that AI pattern suggestions should become meaningful only after enough entries accumulate, rather than reacting too strongly to one or two nights.[cite:125]

## Likely v1 structure

A practical Atlas sleep v1 should include:

### Capture
- Screenshot upload
- Parsed metrics review
- Manual correction if needed
- Morning free note

### Context
- Relevant night checklist signals
- Night notes reference

### Review
- Sleep history cards or timeline
- 7-day and 30-day duration trend
- Deep/REM trend
- AI pattern observation panel

## Deferred / later ideas

These items are not required for the first sleep version, but remain good future directions:

- Direct Gabit integration investigation
- Bedtime/wake consistency analytics
- Proactive pre-sleep AI guidance based on established patterns
- Tighter correlation views between sleep and other life systems

## Boundaries

The current sleep planning direction does **not** assume:

- a public Gabit API,
- a medical-grade sensor interpretation layer,
- forced rating dropdowns for subjective morning feeling,
- or duplicate manual logging of night context already present in checklist/notes.

The goal is a realistic, integrated, low-friction sleep system that can later support thoughtful AI guidance.
