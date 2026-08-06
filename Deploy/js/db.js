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
            // Fixed 2026-07-29 (Phase 1 close audit): was the only
            // single-record getter in this file missing the deleted_at
            // filter -- a stale link/pending-nav to a since-deleted project
            // would still load and render its old data instead of erroring.
            const { data, error } = await supabase.from('atlas_projects').select('*').eq('id', id).is('deleted_at', null).single();
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
        // Tasks/reminders (kind='task'|'reminder') whose scheduled_date falls
        // in the window -- works identically for a past window (what was
        // planned) or a future window (what's coming up). Deliberately does
        // NOT filter archived_at -- a task archived after the window still
        // represents real activity/plan that existed in it, which the
        // Calendar/AI history pipeline should not silently hide.
        async listScheduledInRange(startDate, endDate) {
            const { data, error } = await supabase
                .from('atlas_tasks')
                .select('*')
                .gte('scheduled_date', startDate)
                .lte('scheduled_date', endDate)
                .is('deleted_at', null)
                .order('scheduled_date', { ascending: true });
            if (error) throw new Error(error.message);
            return data;
        },
        // Tasks completed inside the window, by completed_at timestamp (not
        // scheduled_date) -- a task scheduled days earlier but finished today
        // should show as activity on today, not on its original schedule.
        async listCompletedInRange(startDate, endDate) {
            const { data, error } = await supabase
                .from('atlas_tasks')
                .select('*')
                .eq('status', 'done')
                .gte('completed_at', `${startDate}T00:00:00`)
                .lte('completed_at', `${endDate}T23:59:59.999`)
                .is('deleted_at', null)
                .order('completed_at', { ascending: true });
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
        // Global (all projects) date-range read -- atlas_task_logs already
        // carries its own entry_date/deleted_at columns directly, no join
        // needed. Used by the Calendar and the AI history pipeline, which
        // both need "what work-log activity happened on date X" without
        // picking a project first.
        async listForDateRange(startDate, endDate) {
            const { data, error } = await supabase
                .from('atlas_task_logs')
                .select('*')
                .gte('entry_date', startDate)
                .lte('entry_date', endDate)
                .is('deleted_at', null)
                .order('entry_date', { ascending: true });
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
        // All notes in the window regardless of project_id (unlike
        // listGlobal, which only returns project_id IS NULL notes) --
        // ranged over created_at since this table has no entry_date column.
        // Used by the Calendar/AI history pipeline to know which days had
        // any project note activity, project-linked or not.
        async listForDateRange(startDate, endDate) {
            const { data, error } = await supabase
                .from('atlas_project_notes')
                .select('*')
                .gte('created_at', `${startDate}T00:00:00`)
                .lte('created_at', `${endDate}T23:59:59.999`)
                .is('deleted_at', null)
                .order('created_at', { ascending: true });
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
        // True calendar-date range (unlike listRecent, which is anchored to
        // "most recent N rows" and can't jump to an arbitrary past/future
        // window). Used by the Calendar and the AI history pipeline.
        async listForDateRange(startDate, endDate) {
            const { data, error } = await supabase
                .from('atlas_notebook_entries')
                .select('*')
                .gte('entry_date', startDate)
                .lte('entry_date', endDate)
                .is('deleted_at', null)
                .order('entry_date', { ascending: true });
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

    // Journal: personal reflections/feelings linked to a calendar day.
    // Separate from Notebook (which is the freeform working scratchpad).
    // AI reads Journal; AI does NOT read Notebook.
    // Table: atlas_journal_entries (created 2026-08-04 separation pass).
    Journal: {
        async listForDateRange(startDate, endDate) {
            const { data, error } = await supabase
                .from('atlas_journal_entries')
                .select('*')
                .gte('entry_date', startDate)
                .lte('entry_date', endDate)
                .is('deleted_at', null)
                .order('entry_date', { ascending: true });
            if (error) throw new Error(error.message);
            return data;
        },
        async getByDate(entryDate) {
            const { data, error } = await supabase
                .from('atlas_journal_entries')
                .select('*')
                .eq('entry_date', entryDate)
                .is('deleted_at', null)
                .maybeSingle();
            if (error) throw new Error(error.message);
            return data;
        },
        create(row) { return verifiedInsert('atlas_journal_entries', row); },
        update(id, patch) { return verifiedUpdate('atlas_journal_entries', id, patch); },
        async softDelete(id) { return (await verifiedRpc('atlas_journal_entries_soft_delete'))(id); },
        async restoreFromTrash(id) { return (await verifiedRpc('atlas_journal_entries_restore_trash'))(id); },
        hardDelete(id) { return verifiedHardDelete('atlas_journal_entries', id); }
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
        // True calendar-date range (unlike listRecent, row-count-anchored).
        // A future window naturally returns empty -- you can't log sleep for
        // a day that hasn't happened yet. Used by the Calendar and the AI
        // history pipeline.
        async listForDateRange(startDate, endDate) {
            const { data, error } = await supabase
                .from('atlas_sleep_logs')
                .select('*')
                .gte('entry_date', startDate)
                .lte('entry_date', endDate)
                .is('deleted_at', null)
                .order('entry_date', { ascending: true });
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
        // True calendar-date range (unlike listRecent, row-count-anchored).
        // A future window naturally returns empty. Used by the Calendar and
        // the AI history pipeline.
        async listForDateRange(startDate, endDate) {
            const { data, error } = await supabase
                .from('atlas_workout_logs')
                .select('*')
                .gte('entry_date', startDate)
                .lte('entry_date', endDate)
                .is('deleted_at', null)
                .order('entry_date', { ascending: true });
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
    },

    Family: {
        async listChecklistItems() {
            const { data, error } = await supabase
                .from('atlas_family_checklist_items')
                .select('*')
                .eq('active', true)
                .order('order_index', { ascending: true });
            if (error) throw new Error(error.message);
            return data;
        },
        async listChecklistHistoryForDate(entryDate) {
            const { data, error } = await supabase
                .from('atlas_family_checklist_history')
                .select('*')
                .eq('entry_date', entryDate);
            if (error) throw new Error(error.message);
            return data;
        },
        async setChecklistStatus(itemId, entryDate, status) {
            const payload = { item_id: itemId, entry_date: entryDate, status };
            const { data, error } = await supabase
                .from('atlas_family_checklist_history')
                .upsert(payload, { onConflict: 'item_id,entry_date' })
                .select()
                .single();
            if (error || !data) throw new Error(error?.message || 'Checklist status update was not confirmed');
            return data;
        },
        createChecklistItem(row) { return verifiedInsert('atlas_family_checklist_items', row); },
        updateChecklistItem(id, patch) { return verifiedUpdate('atlas_family_checklist_items', id, patch); },
        async deleteChecklistItem(id) {
            const { error } = await supabase.from('atlas_family_checklist_items').delete().eq('id', id);
            if (error) throw new Error(error.message);
        },
        
        async listTasks() {
            const { data, error } = await supabase
                .from('atlas_family_tasks')
                .select('*')
                .eq('status', 'pending')
                .order('created_at', { ascending: false });
            if (error) throw new Error(error.message);
            return data;
        },
        async listCompletedTasks(limit = 20) {
            const { data, error } = await supabase
                .from('atlas_family_tasks')
                .select('*')
                .eq('status', 'done')
                .order('completed_at', { ascending: false })
                .limit(limit);
            if (error) throw new Error(error.message);
            return data;
        },
        createTask(row) { return verifiedInsert('atlas_family_tasks', row); },
        updateTask(id, patch) { return verifiedUpdate('atlas_family_tasks', id, patch); },
        async deleteTask(id) {
            const { error } = await supabase.from('atlas_family_tasks').delete().eq('id', id);
            if (error) throw new Error(error.message);
        },
        async completeTask(id) {
            const payload = { status: 'done', completed_at: new Date().toISOString() };
            return verifiedUpdate('atlas_family_tasks', id, payload);
        },
        
        async getNote() {
            const { data, error } = await supabase
                .from('atlas_family_notes')
                .select('*')
                .eq('id', 1)
                .maybeSingle();
            if (error) throw new Error(error.message);
            return data;
        },
        async setNote(body) {
            const payload = { id: 1, body, is_read: false, updated_at: new Date().toISOString() };
            const { data, error } = await supabase
                .from('atlas_family_notes')
                .upsert(payload, { onConflict: 'id' })
                .select()
                .single();
            if (error || !data) throw new Error(error?.message || 'Note update was not confirmed');
            return data;
        },
        async markNoteRead() {
            const payload = { is_read: true, updated_at: new Date().toISOString() };
            return verifiedUpdate('atlas_family_notes', 1, payload);
        },

        // ---- push subscriptions (2026-08-07) ----
        // Separate table from pos_push_subscriptions -- this is Ritu's
        // device, not Abhishek's own reminders. Used by the family app's
        // own subscribe toggle, read by the send-family-push Edge Function.
        async getPushSubscription(endpoint) {
            const { data, error } = await supabase
                .from('atlas_family_push_subscriptions')
                .select('*')
                .eq('endpoint', endpoint)
                .maybeSingle();
            if (error) throw new Error(error.message);
            return data;
        },
        async savePushSubscription(sub) {
            const payload = { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, updated_at: new Date().toISOString() };
            const { data, error } = await supabase
                .from('atlas_family_push_subscriptions')
                .upsert(payload, { onConflict: 'endpoint' })
                .select()
                .single();
            if (error || !data) throw new Error(error?.message || 'Push subscription save was not confirmed');
            return data;
        },
        async removePushSubscription(endpoint) {
            const { error } = await supabase.from('atlas_family_push_subscriptions').delete().eq('endpoint', endpoint);
            if (error) throw new Error(error.message);
        }
    }
};
