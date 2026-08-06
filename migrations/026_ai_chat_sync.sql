-- Migration 026: Atlas AI chat history sync.
-- AI chat history was local-only (localStorage, 24h wipe) since the panel
-- was first built -- fine when it was a single-device scratch conversation,
-- not once Abhishek started using it seriously across phone and desktop
-- (confirmed 2026-08-08: a phone conversation didn't carry over to desktop
-- at all). One row holding the whole message array, same shape and same
-- last-write-wins pattern as atlas_ai_notebook -- single-tenant app, no
-- profile_id, no need for a heavier per-message table.

CREATE TABLE atlas_ai_chat (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE atlas_ai_chat ENABLE ROW LEVEL SECURITY;

CREATE POLICY atlas_ai_chat_all ON atlas_ai_chat
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER atlas_ai_chat_set_updated_at
    BEFORE UPDATE ON atlas_ai_chat
    FOR EACH ROW EXECUTE FUNCTION atlas_set_updated_at();
