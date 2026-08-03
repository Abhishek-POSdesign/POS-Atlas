-- Migration 018: Push Notifications Support
-- Creates a table to store Web Push API subscription objects (endpoint and keys) per user.

CREATE TABLE pos_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups by user (e.g. when cron job wants to push to a specific user)
CREATE INDEX idx_pos_push_subs_user_id ON pos_push_subscriptions(user_id);

-- Enable RLS
ALTER TABLE pos_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see and manage their own subscriptions
CREATE POLICY "Users can view own push subscriptions"
    ON pos_push_subscriptions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own push subscriptions"
    ON pos_push_subscriptions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own push subscriptions"
    ON pos_push_subscriptions FOR DELETE
    USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER trg_pos_push_subscriptions_updated_at
    BEFORE UPDATE ON pos_push_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION handle_updated_at();

-- Add a pos_push_log table to track sent notifications and prevent duplicates
CREATE TABLE pos_push_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    target_id UUID, -- For example, the pos_tasks.id that this push was about
    notification_type TEXT NOT NULL, -- e.g. 'task_reminder'
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'sent'
);

CREATE INDEX idx_pos_push_log_user_target ON pos_push_log(user_id, target_id, notification_type);

ALTER TABLE pos_push_log ENABLE ROW LEVEL SECURITY;

-- Note: pos_push_log is largely for the backend (Edge Functions/cron) to read/write, 
-- but users can read their own logs.
CREATE POLICY "Users can view own push logs"
    ON pos_push_log FOR SELECT
    USING (auth.uid() = user_id);
