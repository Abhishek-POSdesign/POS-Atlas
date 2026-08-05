-- Migration 022: Atlas Family App (Companion for Ritu)
-- Keeps companion app data entirely separate from the main POS/Atlas complexity.

CREATE TABLE atlas_family_checklist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    block TEXT NOT NULL, -- 'Morning', 'Afternoon', 'Evening', 'Sleep'
    active BOOLEAN NOT NULL DEFAULT true,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE atlas_family_checklist_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID REFERENCES atlas_family_checklist_items(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    status TEXT NOT NULL, -- 'done', 'skipped', 'holiday', 'missed'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(item_id, entry_date)
);

CREATE TABLE atlas_family_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    scheduled_date DATE,
    priority TEXT NOT NULL DEFAULT 'normal', -- 'normal' or 'important'
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' or 'done'
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE atlas_family_notes (
    id INTEGER PRIMARY KEY DEFAULT 1,
    body TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (id = 1) -- Enforce single row
);

-- Note: Ritu will use the same auth account as Abhishek, so standard RLS applies.
ALTER TABLE atlas_family_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_family_checklist_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_family_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_family_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON atlas_family_checklist_items
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON atlas_family_checklist_history
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON atlas_family_tasks
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON atlas_family_notes
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Insert the single row for notes right away
INSERT INTO atlas_family_notes (id, body, is_read) VALUES (1, '', true) ON CONFLICT DO NOTHING;
