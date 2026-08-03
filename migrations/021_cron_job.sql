-- Schedule cron job to run every 10 minutes
SELECT cron.schedule(
    'atlas-send-reminders',
    '*/10 * * * *',
    $$
    SELECT net.http_post(
        url:='https://vcndlorrrtueofzuynvi.supabase.co/functions/v1/send-reminders',
        headers:='{"Content-Type": "application/json"}'::jsonb,
        body:=concat('{"time": "', now(), '"}')::jsonb
    );
    $$
);
