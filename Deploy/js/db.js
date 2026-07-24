// db.js
// Single choke-point for Supabase. 
// Every write is verified via .select().single()
// Every read filters deleted_at IS NULL

import { CONFIG } from './config.js';

/* 
 * NOTE: Full Supabase client initialization omitted in Phase 0.
 * In Phase 1, import the Supabase JS client and initialize it here.
 */

const supabase = null; // window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

/**
 * Example verified write pattern for Phase 1:
 * async function verifiedWrite(query) {
 *    const { data, error } = await query.select().single();
 *    if (error || !data) throw new Error('Write failed or unverified');
 *    return data;
 * }
 */

export const DB = {
    Projects: {
        async listActive() {
            // return supabase.from('atlas_projects').select('*').is('deleted_at', null).is('archived_at', null);
            return [];
        },
        async softDelete(id) {
            // return verifiedWrite(supabase.from('atlas_projects').update({ deleted_at: new Date().toISOString() }).eq('id', id));
        }
    },
    Tasks: {
        // Task operations
    },
    Checklist: {
        // Checklist operations
    },
    Notebook: {
        // Notebook operations
    },
    Targets: {
        // Target operations
    }
};
