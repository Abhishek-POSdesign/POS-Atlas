-- Migration 025: schedule the daily digest at 12:00 PM IST (06:30 UTC).
-- Noon, not morning -- Abhishek works nights, so his "day" hasn't turned
-- over yet at 6-7 AM. Same net.http_post + pg_cron pattern as migration 021.

SELECT cron.schedule(
    'atlas-daily-digest',
    '30 6 * * *',
    $$
    SELECT net.http_post(
        url:='https://vcndlorrrtueofzuynvi.supabase.co/functions/v1/atlas-daily-digest',
        headers:='{"Content-Type": "application/json"}'::jsonb,
        body:='{}'::jsonb
    );
    $$
);
