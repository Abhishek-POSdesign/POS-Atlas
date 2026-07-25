// The one place the Supabase JS client is created.
// auth.js and db.js both import this -- neither creates its own client.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { CONFIG } from './config.js';

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true
    }
});
