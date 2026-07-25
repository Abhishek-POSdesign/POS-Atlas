// Supabase configuration.
// Same Supabase project as the other POS apps (Sikka Personal Apps) --
// Atlas only ever touches its own atlas_ tables. The anon key is safe to
// ship client-side: every atlas_ table's RLS policy requires a real signed-in
// session (see migrations/002_auth_rls_policies.sql), so this key alone
// grants no access to any data.

export const CONFIG = {
    SUPABASE_URL: 'https://vcndlorrrtueofzuynvi.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjbmRsb3JycnR1ZW9menV5bnZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MDQ1NjEsImV4cCI6MjA5Nzk4MDU2MX0.F1EfbQPNjp7IupfIUYr0UehnwFckh3jmlEIrxWk1Xi0'
};
