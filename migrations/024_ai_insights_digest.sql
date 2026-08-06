-- Migration 024: Atlas AI daily digest.
-- One row per calendar day holding up to 5 "worth knowing" insight items the
-- noon digest job generated (carried tasks, bills due soon, checklist gaps,
-- sleep/workout trends, quiet projects). Each item is a compact object the
-- Today page's rotating ticker reads and re-checks live against current
-- state before ever showing it -- this table only holds what the AI
-- proposed at generation time, not a live truth source for any one item.
-- Single-tenant app (no profile_id), same pattern as atlas_ai_notebook.

CREATE TABLE atlas_ai_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_date DATE NOT NULL UNIQUE,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE atlas_ai_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY atlas_ai_insights_all ON atlas_ai_insights
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER atlas_ai_insights_set_updated_at
    BEFORE UPDATE ON atlas_ai_insights
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
