// db.js
// The ONLY file that talks to Supabase. Sectioned by entity.
// Every write is verified: insert/update use .select().single() and check
// the returned row; soft-delete/archive/restore call a database function
// (see migrations/003_...) and check that a row came back. A null/empty
// result or an error is always treated as a failed write -- callers must
// roll back their optimistic UI, never assume success.

import { supabase } from './supabase-client.js';

async function verifiedInsert(table, row) {
    const { data, error } = await supabase.from(table).insert(row).select().single();
    if (error || !data) throw new Error(error?.message || `Insert into ${table} was not confirmed`);
    return data;
}

async function verifiedUpdate(table, id, patch) {
    const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message || `Update to ${table} was not confirmed`);
    return data;
}

async function verifiedRpc(fnName) {
    return async (id, extraArgs = {}) => {
        const { data, error } = await supabase.rpc(fnName, { p_id: id, ...extraArgs });
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) throw new Error(`${fnName} affected zero rows -- treat as failed`);
        return data[0];
    };
}

async function verifiedHardDelete(table, id) {
    // Only ever called from the Restore view. Guarded so it can only ever
    // remove a row that is already soft-deleted -- never a live row.
    const { data, error } = await supabase
        .from(table)
        .delete()
        .eq('id', id)
        .not('deleted_at', 'is', null)
        .select();
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error(`Hard delete on ${table} affected zero rows`);
    return data[0];
}

export const DB = {
    Projects: {
        async listActive() {
            const { data, error } = await supabase
                .from('atlas_projects')
                .select('*')
                .is('deleted_at', null)
                .is('archived_at', null)
                .order('order_index', { ascending: true });
            if (error) throw new Error(error.message);
            return data;
        },
        async listArchived() {
            const { data, error } = await supabase
                .from('atlas_projects')
                .select('*')
                .is('deleted_at', null)
                .not('archived_at', 'is', null)
                .order('archived_at', { ascending: false });
            if (error) throw new Error(error.message);
            return data;
        },
        async listDeleted() {
            const { data, error } = await supabase
                .from('atlas_projects')
                .select('*')
                .not('deleted_at', 'is', null)
                .order('deleted_at', { ascending: false });
            if (error) throw new Error(error.message);
            return data;
        },
        async getById(id) {
            const { data, error } = await supabase.from('atlas_projects').select('*').eq('id', id).single();
            if (error) throw new Error(error.message);
            return data;
        },
        create(row) { return verifiedInsert('atlas_projects', row); },
        update(id, patch) { return verifiedUpdate('atlas_projects', id, patch); },
        async softDelete(id) { return (await verifiedRpc('atlas_projects_soft_delete'))(id); },
        async restoreFromTrash(id) { return (await verifiedRpc('atlas_projects_restore_trash'))(id); },
        async archive(id) { return (await verifiedRpc('atlas_projects_archive'))(id); },
        async restoreFromArchive(id) { return (await verifiedRpc('atlas_projects_restore_archive'))(id); },
        hardDelete(id) { return verifiedHardDelete('atlas_projects', id); }
    },

    Tasks: {
        async listActive() {
            const { data, error } = await supabase
                .from('atlas_tasks')
                .select('*')
                .is('deleted_at', null)
                .is('archived_at', null)
                .order('scheduled_date', { ascending: true, nullsFirst: false });
            if (error) throw new Error(error.message);
            return data;
        },
        async listForProject(projectId) {
            const { data, error } = await supabase
                .from('atlas_tasks')
                .select('*')
                .eq('project_id', projectId)
                .is('deleted_at', null)
                .is('archived_at', null)
                .order('scheduled_date', { ascending: true, nullsFirst: false });
            if (error) throw new Error(error.message);
            return data;
        },
        async listDeleted() {
            const { data, error } = await supabase
                .from('atlas_tasks')
                .select('*')
                .not('deleted_at', 'is', null)
                .order('deleted_at', { ascending: false });
            if (error) throw new Error(error.message);
            return data;
        },
        create(row) { return verifiedInsert('atlas_tasks', row); },
        update(id, patch) { return verifiedUpdate('atlas_tasks', id, patch); },
        async start(id, note) {
            const { data, error } = await supabase.rpc('atlas_tasks_start', { p_id: id, p_note: note ?? null });
            if (error) throw new Error(error.message);
            if (!data || data.length === 0) throw new Error('Start task affected zero rows');
            return data[0];
        },
        async complete(id, note) {
            const { data, error } = await supabase.rpc('atlas_tasks_complete', { p_id: id, p_note: note ?? null });
            if (error) throw new Error(error.message);
            if (!data || data.length === 0) throw new Error('Complete task affected zero rows');
            return data[0];
        },
        async softDelete(id) { return (await verifiedRpc('atlas_tasks_soft_delete'))(id); },
        async restoreFromTrash(id) { return (await verifiedRpc('atlas_tasks_restore_trash'))(id); },
        async archive(id) { return (await verifiedRpc('atlas_tasks_archive'))(id); },
        async restoreFromArchive(id) { return (await verifiedRpc('atlas_tasks_restore_archive'))(id); },
        hardDelete(id) { return verifiedHardDelete('atlas_tasks', id); }
    },

    TaskLogs: {
        async listForProject(projectId) {
            const { data, error } = await supabase
                .from('atlas_task_logs')
                .select('*')
                .eq('project_id', projectId)
                .is('deleted_at', null)
                .order('entry_date', { ascending: false });
            if (error) throw new Error(error.message);
            return data;
        },
        create(row) { return verifiedInsert('atlas_task_logs', row); },
        update(id, patch) { return verifiedUpdate('atlas_task_logs', id, patch); },
        async softDelete(id) { return (await verifiedRpc('atlas_task_logs_soft_delete'))(id); },
        async restoreFromTrash(id) { return (await verifiedRpc('atlas_task_logs_restore_trash'))(id); }
    },

    ProjectNotes: {
        async listGlobal() {
            const { data, error } = await supabase
                .from('atlas_project_notes')
                .select('*')
                .is('project_id', null)
                .is('deleted_at', null)
                .order('created_at', { ascending: false });
            if (error) throw new Error(error.message);
            return data;
        },
        create(row) { return verifiedInsert('atlas_project_notes', row); },
        update(id, patch) { return verifiedUpdate('atlas_project_notes', id, patch); },
        update(id, patch) { return verifiedUpdate('atlas_project_notes', id, patch); },
        async softDelete(id) { return (await verifiedRpc('atlas_project_notes_soft_delete'))(id); },
        async restoreFromTrash(id) { return (await verifiedRpc('atlas_project_notes_restore_trash'))(id); }
    },

    Notebook: {
        async listRecent(limit = 30) {
            const { data, error } = await supabase
                .from('atlas_notebook_entries')
                .select('*')
                .is('deleted_at', null)
                .order('entry_date', { ascending: false })
                .limit(limit);
            if (error) throw new Error(error.message);
            return data;
        },
        async getByDate(entryDate) {
            const { data, error } = await supabase
                .from('atlas_notebook_entries')
                .select('*')
                .eq('entry_date', entryDate)
                .is('deleted_at', null)
                .maybeSingle();
            if (error) throw new Error(error.message);
            return data;
        },
        create(row) { return verifiedInsert('atlas_notebook_entries', row); },
        update(id, patch) { return verifiedUpdate('atlas_notebook_entries', id, patch); },
        async softDelete(id) { return (await verifiedRpc('atlas_notebook_entries_soft_delete'))(id); },
        async restoreFromTrash(id) { return (await verifiedRpc('atlas_notebook_entries_restore_trash'))(id); }
    },

    Checklist: {
        async listItems() {
            const { data, error } = await supabase
                .from('atlas_checklist_items')
                .select('*')
                .is('deleted_at', null)
                .is('archived_at', null)
                .order('order_index', { ascending: true });
            if (error) throw new Error(error.message);
            return data;
        },
        async listHistoryForDate(entryDate) {
            const { data, error } = await supabase
                .from('atlas_checklist_history')
                .select('*')
                .eq('entry_date', entryDate)
                .is('deleted_at', null);
            if (error) throw new Error(error.message);
            return data;
        },
        createItem(row) { return verifiedInsert('atlas_checklist_items', row); },
        updateItem(id, patch) { return verifiedUpdate('atlas_checklist_items', id, patch); },
        async archiveItem(id) { return (await verifiedRpc('atlas_checklist_items_archive'))(id); },
        async restoreItemFromArchive(id) { return (await verifiedRpc('atlas_checklist_items_restore_archive'))(id); },
        async softDeleteItem(id) { return (await verifiedRpc('atlas_checklist_items_soft_delete'))(id); },
        async restoreItemFromTrash(id) { return (await verifiedRpc('atlas_checklist_items_restore_trash'))(id); },
        // Marking a status is an upsert keyed on the (item_id, entry_date) unique
        // constraint -- one status per item per day. deleted_at is reset to null
        // here too, so re-marking a day whose entry was previously undone (soft
        // deleted) revives that same row instead of colliding with it.
        // extra.loggedTime / extra.note are plain user-entered fields (like a
        // task's scheduled_time), not system audit timestamps -- fine to upsert
        // directly, no RPC needed.
        async setStatus(itemId, entryDate, status, extra = {}) {
            const payload = { item_id: itemId, entry_date: entryDate, status, deleted_at: null };
            if (extra.loggedTime !== undefined) payload.logged_time = extra.loggedTime || null;
            if (extra.note !== undefined) payload.note = extra.note || null;
            const { data, error } = await supabase
                .from('atlas_checklist_history')
                .upsert(payload, { onConflict: 'item_id,entry_date' })
                .select()
                .single();
            if (error || !data) throw new Error(error?.message || 'Checklist status update was not confirmed');
            return data;
        },
        async undoStatus(historyId) { return (await verifiedRpc('atlas_checklist_history_soft_delete'))(historyId); }
    },

    Targets: {
        // Phase 3 -- not built yet.
    }
};
