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
        async listDeleted() {
            const { data, error } = await supabase
                .from('atlas_task_logs')
                .select('*')
                .not('deleted_at', 'is', null)
                .order('deleted_at', { ascending: false });
            if (error) throw new Error(error.message);
            return data;
        },
        create(row) { return verifiedInsert('atlas_task_logs', row); },
        update(id, patch) { return verifiedUpdate('atlas_task_logs', id, patch); },
        async softDelete(id) { return (await verifiedRpc('atlas_task_logs_soft_delete'))(id); },
        async restoreFromTrash(id) { return (await verifiedRpc('atlas_task_logs_restore_trash'))(id); },
        hardDelete(id) { return verifiedHardDelete('atlas_task_logs', id); }
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
        async listDeleted() {
            const { data, error } = await supabase
                .from('atlas_project_notes')
                .select('*')
                .not('deleted_at', 'is', null)
                .order('deleted_at', { ascending: false });
            if (error) throw new Error(error.message);
            return data;
        },
        create(row) { return verifiedInsert('atlas_project_notes', row); },
        update(id, patch) { return verifiedUpdate('atlas_project_notes', id, patch); },
        async softDelete(id) { return (await verifiedRpc('atlas_project_notes_soft_delete'))(id); },
        async restoreFromTrash(id) { return (await verifiedRpc('atlas_project_notes_restore_trash'))(id); },
        hardDelete(id) { return verifiedHardDelete('atlas_project_notes', id); }
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
        async listDeleted() {
            const { data, error } = await supabase
                .from('atlas_notebook_entries')
                .select('*')
                .not('deleted_at', 'is', null)
                .order('deleted_at', { ascending: false });
            if (error) throw new Error(error.message);
            return data;
        },
        create(row) { return verifiedInsert('atlas_notebook_entries', row); },
        update(id, patch) { return verifiedUpdate('atlas_notebook_entries', id, patch); },
        async softDelete(id) { return (await verifiedRpc('atlas_notebook_entries_soft_delete'))(id); },
        async restoreFromTrash(id) { return (await verifiedRpc('atlas_notebook_entries_restore_trash'))(id); },
        hardDelete(id) { return verifiedHardDelete('atlas_notebook_entries', id); }
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
        // For Restore -- includes archived-and-then-deleted, so a label
        // lookup for a deleted history row can still find its item's name.
        async listAllItems() {
            const { data, error } = await supabase
                .from('atlas_checklist_items')
                .select('*')
                .order('order_index', { ascending: true });
            if (error) throw new Error(error.message);
            return data;
        },
        async listDeletedItems() {
            const { data, error } = await supabase
                .from('atlas_checklist_items')
                .select('*')
                .not('deleted_at', 'is', null)
                .order('deleted_at', { ascending: false });
            if (error) throw new Error(error.message);
            return data;
        },
        async listDeletedHistory() {
            const { data, error } = await supabase
                .from('atlas_checklist_history')
                .select('*')
                .not('deleted_at', 'is', null)
                .order('deleted_at', { ascending: false });
            if (error) throw new Error(error.message);
            return data;
        },
        hardDeleteItem(id) { return verifiedHardDelete('atlas_checklist_items', id); },
        hardDeleteHistory(id) { return verifiedHardDelete('atlas_checklist_history', id); },
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
        async undoStatus(historyId) { return (await verifiedRpc('atlas_checklist_history_soft_delete'))(historyId); },
        // Restore counterpart for undoStatus -- brings a mis-undone mark back
        // from the trash (used by the Restore view).
        async restoreHistory(historyId) { return (await verifiedRpc('atlas_checklist_history_restore_trash'))(historyId); },
        // For the trend graph -- all history rows across a date range, in one query.
        async listHistoryRange(startDate, endDate) {
            const { data, error } = await supabase
                .from('atlas_checklist_history')
                .select('*')
                .gte('entry_date', startDate)
                .lte('entry_date', endDate)
                .is('deleted_at', null);
            if (error) throw new Error(error.message);
            return data;
        }
    },

    Sleep: {
        async getByDate(entryDate) {
            const { data, error } = await supabase
                .from('atlas_sleep_logs')
                .select('*')
                .eq('entry_date', entryDate)
                .is('deleted_at', null)
                .maybeSingle();
            if (error) throw new Error(error.message);
            return data;
        },
        async listRecent(limit = 14) {
            const { data, error } = await supabase
                .from('atlas_sleep_logs')
                .select('*')
                .is('deleted_at', null)
                .order('entry_date', { ascending: false })
                .limit(limit);
            if (error) throw new Error(error.message);
            return data;
        },
        // One row per day (entry_date unique) -- same upsert pattern as
        // Checklist.setStatus, since "log tonight's sleep" is naturally an
        // upsert against today's date, not an insert-then-update dance.
        async save(entryDate, patch) {
            const payload = { entry_date: entryDate, deleted_at: null, ...patch };
            const { data, error } = await supabase
                .from('atlas_sleep_logs')
                .upsert(payload, { onConflict: 'entry_date' })
                .select()
                .single();
            if (error || !data) throw new Error(error?.message || 'Sleep log save was not confirmed');
            return data;
        },
        async listDeleted() {
            const { data, error } = await supabase
                .from('atlas_sleep_logs')
                .select('*')
                .not('deleted_at', 'is', null)
                .order('deleted_at', { ascending: false });
            if (error) throw new Error(error.message);
            return data;
        },
        async softDelete(id) { return (await verifiedRpc('atlas_sleep_logs_soft_delete'))(id); },
        async restoreFromTrash(id) { return (await verifiedRpc('atlas_sleep_logs_restore_trash'))(id); },
        hardDelete(id) { return verifiedHardDelete('atlas_sleep_logs', id); }
    },

    WorkoutSessions: {
        async listForLog(workoutLogId) {
            const { data, error } = await supabase
                .from('atlas_workout_sessions')
                .select('*')
                .eq('workout_log_id', workoutLogId)
                .order('created_at', { ascending: true });
            if (error) throw new Error(error.message);
            return data;
        },
        async listForDateRange(startDate, endDate) {
            const { data, error } = await supabase
                .from('atlas_workout_sessions')
                .select('*, atlas_workout_logs!inner(entry_date)')
                .gte('atlas_workout_logs.entry_date', startDate)
                .lte('atlas_workout_logs.entry_date', endDate)
                .is('atlas_workout_logs.deleted_at', null);
            if (error) throw new Error(error.message);
            return data;
        },
        create(workoutLogId, session) {
            return verifiedInsert('atlas_workout_sessions', { workout_log_id: workoutLogId, ...session });
        },
        update(id, patch) { return verifiedUpdate('atlas_workout_sessions', id, patch); },
        async remove(id) {
            const { data, error } = await supabase
                .from('atlas_workout_sessions')
                .delete()
                .eq('id', id)
                .select();
            if (error) throw new Error(error.message);
            if (!data || data.length === 0) throw new Error('Delete workout session affected zero rows');
            return data[0];
        }
    },

    WorkoutTargets: {
        async list() {
            const { data, error } = await supabase
                .from('atlas_workout_targets')
                .select('*')
                .order('activity_type', { ascending: true });
            if (error) throw new Error(error.message);
            return data;
        },
        async upsert(activityType, patch) {
            const payload = { activity_type: activityType, ...patch };
            const { data, error } = await supabase
                .from('atlas_workout_targets')
                .upsert(payload, { onConflict: 'activity_type' })
                .select()
                .single();
            if (error || !data) throw new Error(error?.message || 'Workout target upsert was not confirmed');
            return data;
        }
    },

    HealthSettings: {
        async get() {
            const { data, error } = await supabase
                .from('atlas_health_settings')
                .select('*')
                .maybeSingle();
            if (error) throw new Error(error.message);
            return data;
        },
        async save(patch) {
            const existing = await this.get();
            if (existing) {
                return verifiedUpdate('atlas_health_settings', existing.id, patch);
            }
            return verifiedInsert('atlas_health_settings', patch);
        }
    },

    Workout: {
        async getByDate(entryDate) {
            const { data, error } = await supabase
                .from('atlas_workout_logs')
                .select('*')
                .eq('entry_date', entryDate)
                .is('deleted_at', null)
                .maybeSingle();
            if (error) throw new Error(error.message);
            return data;
        },
        async listRecent(limit = 14) {
            const { data, error } = await supabase
                .from('atlas_workout_logs')
                .select('*')
                .is('deleted_at', null)
                .order('entry_date', { ascending: false })
                .limit(limit);
            if (error) throw new Error(error.message);
            return data;
        },
        async save(entryDate, patch) {
            const payload = { entry_date: entryDate, deleted_at: null, ...patch };
            const { data, error } = await supabase
                .from('atlas_workout_logs')
                .upsert(payload, { onConflict: 'entry_date' })
                .select()
                .single();
            if (error || !data) throw new Error(error?.message || 'Workout log save was not confirmed');
            return data;
        },
        async listDeleted() {
            const { data, error } = await supabase
                .from('atlas_workout_logs')
                .select('*')
                .not('deleted_at', 'is', null)
                .order('deleted_at', { ascending: false });
            if (error) throw new Error(error.message);
            return data;
        },
        async softDelete(id) { return (await verifiedRpc('atlas_workout_logs_soft_delete'))(id); },
        async restoreFromTrash(id) { return (await verifiedRpc('atlas_workout_logs_restore_trash'))(id); },
        hardDelete(id) { return verifiedHardDelete('atlas_workout_logs', id); }
    },

    // Atlas AI Memory Notebook -- single-row cloud backup for the AI's
    // pin/session/compact entries. The client's real read path on every AI
    // message is localStorage (see features/aiConfig.js); this table only
    // gets touched on notebook writes and the occasional pull-and-merge,
    // same single-row-upsert shape as HealthSettings below.
    AiNotebook: {
        async get() {
            const { data, error } = await supabase
                .from('atlas_ai_notebook')
                .select('*')
                .maybeSingle();
            if (error) throw new Error(error.message);
            return data;
        },
        async save(entries) {
            const existing = await this.get();
            if (existing) {
                return verifiedUpdate('atlas_ai_notebook', existing.id, { entries });
            }
            return verifiedInsert('atlas_ai_notebook', { entries });
        }
    },

    // Only the streak (kind='streak') side of Targets is built -- Phase 3 owns
    // the count_toward_goal card UI and its own methods here.
    Targets: {
        async listStreaks() {
            const { data, error } = await supabase
                .from('atlas_targets')
                .select('*')
                .eq('kind', 'streak')
                .is('deleted_at', null)
                .is('archived_at', null)
                .order('created_at', { ascending: true });
            if (error) throw new Error(error.message);
            return data;
        },
        // One verified transition: logs the relapse row and either resets the
        // streak (previous_best_days updated) or, if useGrace and grace hasn't
        // been used yet on this streak, keeps it alive and just flips grace_used.
        async logRelapse(id, currentDays, reason, useGrace) {
            const { data, error } = await supabase.rpc('atlas_targets_log_relapse', {
                p_id: id, p_current_days: currentDays, p_reason: reason, p_use_grace: !!useGrace
            });
            if (error) throw new Error(error.message);
            if (!data || data.length === 0) throw new Error('Log relapse affected zero rows');
            return data[0];
        }
    }
};
