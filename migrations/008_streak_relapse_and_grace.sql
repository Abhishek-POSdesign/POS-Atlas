-- Migration 008: streak relapse + grace-day mechanic on atlas_targets, matching the old
-- app's rule (one free grace day per streak life, logged with a required reason, previous
-- best remembered across a reset). Generic column names since Phase 3 goal-cards share the
-- same table -- they just never populate these.

ALTER TABLE atlas_targets ADD COLUMN IF NOT EXISTS previous_best_days INTEGER;
ALTER TABLE atlas_targets ADD COLUMN IF NOT EXISTS grace_used BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE atlas_streak_relapses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id UUID NOT NULL REFERENCES atlas_targets(id),
    occurred_date DATE NOT NULL DEFAULT CURRENT_DATE,
    days INTEGER NOT NULL,
    reason TEXT NOT NULL,
    was_grace BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE atlas_streak_relapses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON atlas_streak_relapses
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Single verified transition: logs the relapse row and either (a) resets the streak to
-- today with previous_best_days updated to the greater of the old best/current run, or
-- (b) if p_use_grace and grace hasn't been used yet on this streak, keeps streak_start_date
-- untouched (the run survives) and just flips grace_used. Current day-count is computed
-- client-side from streak_start_date (today - start), so it's passed in as p_current_days
-- rather than re-derived server-side with another date function.
CREATE OR REPLACE FUNCTION atlas_targets_log_relapse(p_id UUID, p_current_days INTEGER, p_reason TEXT, p_use_grace BOOLEAN DEFAULT false)
RETURNS SETOF atlas_targets LANGUAGE plpgsql AS $$
DECLARE
    v_grace_used BOOLEAN;
    v_prev_best INTEGER;
    v_actually_grace BOOLEAN;
BEGIN
    SELECT grace_used, previous_best_days INTO v_grace_used, v_prev_best
    FROM atlas_targets WHERE id = p_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_actually_grace := p_use_grace AND NOT v_grace_used;

    INSERT INTO atlas_streak_relapses (target_id, days, reason, was_grace)
    VALUES (p_id, p_current_days, p_reason, v_actually_grace);

    IF v_actually_grace THEN
        RETURN QUERY
        UPDATE atlas_targets SET grace_used = true
        WHERE id = p_id AND deleted_at IS NULL
        RETURNING *;
    ELSE
        RETURN QUERY
        UPDATE atlas_targets SET
            streak_start_date = CURRENT_DATE,
            grace_used = false,
            previous_best_days = GREATEST(COALESCE(v_prev_best, 0), p_current_days)
        WHERE id = p_id AND deleted_at IS NULL
        RETURNING *;
    END IF;
END;
$$;
