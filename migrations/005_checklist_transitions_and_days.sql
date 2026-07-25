-- Migration 005: Phase 2 -- checklist item/history transition functions,
-- plus an optional day-of-week restriction field on checklist items
-- (needed to correctly represent 4 items migrated from the old app that
-- only apply on specific days, e.g. "Office Clean" = Sundays only).

ALTER TABLE atlas_checklist_items ADD COLUMN IF NOT EXISTS days INTEGER[];

-- ---------- atlas_checklist_items ----------

CREATE OR REPLACE FUNCTION atlas_checklist_items_soft_delete(p_id UUID)
RETURNS SETOF atlas_checklist_items LANGUAGE sql AS $$
    UPDATE atlas_checklist_items SET deleted_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_checklist_items_restore_trash(p_id UUID)
RETURNS SETOF atlas_checklist_items LANGUAGE sql AS $$
    UPDATE atlas_checklist_items SET deleted_at = NULL
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_checklist_items_archive(p_id UUID)
RETURNS SETOF atlas_checklist_items LANGUAGE sql AS $$
    UPDATE atlas_checklist_items SET archived_at = now(), active = false
    WHERE id = p_id AND archived_at IS NULL AND deleted_at IS NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_checklist_items_restore_archive(p_id UUID)
RETURNS SETOF atlas_checklist_items LANGUAGE sql AS $$
    UPDATE atlas_checklist_items SET archived_at = NULL, active = true
    WHERE id = p_id AND archived_at IS NOT NULL
    RETURNING *;
$$;

-- ---------- atlas_checklist_history ----------

CREATE OR REPLACE FUNCTION atlas_checklist_history_soft_delete(p_id UUID)
RETURNS SETOF atlas_checklist_history LANGUAGE sql AS $$
    UPDATE atlas_checklist_history SET deleted_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION atlas_checklist_history_restore_trash(p_id UUID)
RETURNS SETOF atlas_checklist_history LANGUAGE sql AS $$
    UPDATE atlas_checklist_history SET deleted_at = NULL
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING *;
$$;

-- Backfill day-of-week restrictions for the 4 migrated items that carried
-- one in the old app (pos_checklist_config.days). 0=Sunday..6=Saturday,
-- matching JS Date.getDay() -- same convention the old app used.
UPDATE atlas_checklist_items SET days = ARRAY[0] WHERE name = 'Office Clean';
UPDATE atlas_checklist_items SET days = ARRAY[1,3,5] WHERE name = 'Vitamin, D3, K2, Omega etc...';
UPDATE atlas_checklist_items SET days = ARRAY[1,2,3,4,5] WHERE name = 'Evening Market Login';
UPDATE atlas_checklist_items SET days = ARRAY[0,6] WHERE name = 'Family / Kids Time';
