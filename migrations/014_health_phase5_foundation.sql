-- Migration 014: Phase 5 Health foundation
-- Adds: workout sessions (child rows per activity in a day),
--        workout weekly targets (days/week per activity type),
--        health settings (sleep goal, single-row config).

-- Workout sessions: child table of atlas_workout_logs.
-- A day can have multiple sessions (e.g. strength AM + walk PM).
-- No soft-delete — sessions live/die with their parent log row.
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

CREATE INDEX idx_workout_sessions_log_id ON atlas_workout_sessions(workout_log_id);

-- Workout weekly targets: how many days/week each activity type should happen.
-- Small fixed set (one row per type), rarely changed.
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

CREATE TRIGGER trg_workout_targets_updated_at BEFORE UPDATE ON atlas_workout_targets
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();

-- Health settings: single-row config (sleep goal, future health preferences).
CREATE TABLE atlas_health_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sleep_goal_minutes INTEGER DEFAULT 420,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE atlas_health_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON atlas_health_settings
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_health_settings_updated_at BEFORE UPDATE ON atlas_health_settings
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
