-- 028_checklist_item_type.sql
--
-- Gives every checklist item a TYPE: routine, supplement, or medicine.
--
-- Abhishek's own design, replacing an earlier proposal for a separate
-- medicines list. His reasoning was better than the proposal: he already
-- creates and manages checklist items, so a second list is a second thing to
-- learn for no gain. One checklist, a type picked when the item is created.
--
-- Why this matters beyond tidiness: nine of his sixteen items currently bundle
-- a medicine or supplement into something else ("Lunch + Med + Omega 3",
-- "Dinner + D3K2", "Chamomile Tea + Nasal spray + Magnisium"). One tick claims
-- all three happened, so there is no way to record that he ate lunch but
-- forgot the omega 3 -- and no way for a reminder to chase just the omega 3.
-- His stated reason for wanting this at all is "I forget whether I have taken
-- the medicine or not", so per-item reminders are the point; the type is what
-- makes them addressable.
--
-- Existing rows all become 'routine', which is correct -- they are what the
-- checklist has always been. Splitting the nine bundled items into separate
-- typed items is a SEPARATE, user-confirmed data change and is deliberately
-- NOT done here.
--
-- atlas_checklist_items.notify_enabled / notify_time already exist (migration
-- 023) and are reused as-is -- no new reminder plumbing is needed for this.

ALTER TABLE atlas_checklist_items
    ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'routine';

-- Constrained rather than free text: the three values drive colour, grouping
-- and the ring breakdown, so a typo would silently create a fourth invisible
-- category. Named so a future value can be added by replacing one constraint.
ALTER TABLE atlas_checklist_items
    DROP CONSTRAINT IF EXISTS atlas_checklist_items_type_check;

ALTER TABLE atlas_checklist_items
    ADD CONSTRAINT atlas_checklist_items_type_check
    CHECK (type IN ('routine', 'supplement', 'medicine'));

-- The Routine page and the Today ring both read items grouped by type every
-- load; this keeps that cheap as the list grows.
CREATE INDEX IF NOT EXISTS atlas_checklist_items_type_idx
    ON atlas_checklist_items (type)
    WHERE deleted_at IS NULL AND archived_at IS NULL;
