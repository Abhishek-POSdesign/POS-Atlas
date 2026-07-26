-- Migration 013: Atlas workout day-type
-- Design Review Round 2 · item 5.
-- Adds a per-day type marker so the Workout card can render three states:
--   workout        -> full metric grid (existing behaviour)
--   active_recovery -> one-tap-and-done, calm pulse animation, no metrics
--   full_rest       -> one-tap-and-done, distinct rest icon, no metrics
-- The column is nullable; existing rows and unlogged days remain "unset"
-- (Workout card falls back to the no-data state, same as before this
-- migration). day_type only becomes meaningful when the user taps one of
-- the three chips on the card.

ALTER TABLE atlas_workout_logs
  ADD COLUMN day_type text
    CHECK (day_type IS NULL OR day_type IN ('workout', 'active_recovery', 'full_rest'));
