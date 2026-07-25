-- Migration 009: Workout tracking, same shape/spirit as atlas_sleep_logs (migration 007) --
-- manual entry for now, ready for the same future AI-screenshot-parse feature.

CREATE TABLE atlas_workout_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_date DATE NOT NULL UNIQUE,
    duration_minutes INTEGER,
    workout_type TEXT,
    calories INTEGER,
    note TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE atlas_workout_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON atlas_workout_logs
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON atlas_workout_logs
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();

CREATE OR REPLACE FUNCTION atlas_workout_logs_soft_delete(p_id UUID)
RETURNS SETOF atlas_workout_logs LANGUAGE sql AS $$
    UPDATE atlas_workout_logs SET deleted_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_workout_logs_restore_trash(p_id UUID)
RETURNS SETOF atlas_workout_logs LANGUAGE sql AS $$
    UPDATE atlas_workout_logs SET deleted_at = NULL
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING *;
$$;
