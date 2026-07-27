-- Migration 016: Atlas AI Memory Notebook.
-- Single-row cloud backup for the AI notebook (pin/session/compact entries).
-- The client's real read path is localStorage on every message -- this table
-- is only touched on notebook writes (pin/save session/compact) and on the
-- occasional pull-and-merge, same pattern as atlas_health_settings (single
-- upserted row, no per-entry rows -- entries live together as one jsonb blob,
-- matching the old app's proven pos_ai_notebook shape).

CREATE TABLE atlas_ai_notebook (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entries JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE atlas_ai_notebook ENABLE ROW LEVEL SECURITY;

CREATE POLICY atlas_ai_notebook_all ON atlas_ai_notebook
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER atlas_ai_notebook_set_updated_at
    BEFORE UPDATE ON atlas_ai_notebook
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
