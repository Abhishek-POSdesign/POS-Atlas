-- Migration 007: Sleep tracking. One row per day (entry_date unique), manual
-- entry for now (duration, score, note) -- the richer fields (sleep stages,
-- resting HR, HRV) are included now, nullable, so a future AI-screenshot-
-- parse feature can populate them without another schema change.

CREATE TABLE atlas_sleep_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_date DATE NOT NULL UNIQUE,
    duration_minutes INTEGER,
    sleep_score INTEGER,
    start_time TIME,
    deep_minutes INTEGER,
    rem_minutes INTEGER,
    light_minutes INTEGER,
    awake_minutes INTEGER,
    resting_hr INTEGER,
    hrv NUMERIC,
    note TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE atlas_sleep_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON atlas_sleep_logs
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON atlas_sleep_logs
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();

CREATE OR REPLACE FUNCTION atlas_sleep_logs_soft_delete(p_id UUID)
RETURNS SETOF atlas_sleep_logs LANGUAGE sql AS $$
    UPDATE atlas_sleep_logs SET deleted_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_sleep_logs_restore_trash(p_id UUID)
RETURNS SETOF atlas_sleep_logs LANGUAGE sql AS $$
    UPDATE atlas_sleep_logs SET deleted_at = NULL
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING *;
$$;
