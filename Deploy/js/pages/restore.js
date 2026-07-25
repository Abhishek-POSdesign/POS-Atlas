import { DB } from '../db.js';

// Config-driven: one entry per soft-deletable entity. Adding a new soft-
// deletable entity later is a matter of adding one section here plus its
// listDeleted/hardDelete/restore methods in db.js -- no per-entity markup
// duplication (2026-07-26 correction; pre-rewrite the page only surfaced
// Projects + Tasks, silently orphaning the other 7 entity types).
//
// `kind` maps to the switch in callRestore/callHardDelete below. Order
// here is the order the sections render.
const SECTION_DEFS = [
    { key: 'projects',          label: 'Deleted projects',        kind: 'Projects' },
    { key: 'tasks',             label: 'Deleted tasks',           kind: 'Tasks' },
    { key: 'notebook',          label: 'Deleted notebook entries',kind: 'Notebook' },
    { key: 'project_notes',     label: 'Deleted project notes',   kind: 'ProjectNotes' },
    { key: 'task_logs',         label: 'Deleted work log entries',kind: 'TaskLogs' },
    { key: 'checklist_items',   label: 'Deleted checklist items', kind: 'ChecklistItems' },
    { key: 'checklist_history', label: 'Deleted checklist marks', kind: 'ChecklistHistory' },
    { key: 'sleep',             label: 'Deleted sleep logs',      kind: 'Sleep' },
    { key: 'workout',           label: 'Deleted workout logs',    kind: 'Workout' }
];

export function restorePage(nav) {
    return {
        loading: true,
        errorMsg: '',
        // Fresh clone each mount so `expanded` isn't shared across opens.
        sections: SECTION_DEFS.map(s => ({ ...s, items: [], expanded: false })),
        checklistItemsById: {},
        confirmingHardDelete: null,

        async init() {
            await this.load();
        },
        close() {
            nav.onClose();
        },

        async load() {
            this.loading = true;
            this.errorMsg = '';
            try {
                const [projects, tasks, notebook, projectNotes, taskLogs, checklistItems, checklistHistory, sleep, workout, allItems] = await Promise.all([
                    DB.Projects.listDeleted(),
                    DB.Tasks.listDeleted(),
                    DB.Notebook.listDeleted(),
                    DB.ProjectNotes.listDeleted(),
                    DB.TaskLogs.listDeleted(),
                    DB.Checklist.listDeletedItems(),
                    DB.Checklist.listDeletedHistory(),
                    DB.Sleep.listDeleted(),
                    DB.Workout.listDeleted(),
                    // For labelling deleted history rows -- fetch every item
                    // (including archived + deleted) so a history row whose
                    // parent item is also deleted still gets a name, not a
                    // bare UUID.
                    DB.Checklist.listAllItems()
                ]);
                this.checklistItemsById = Object.fromEntries(allItems.map(i => [i.id, i]));
                const byKey = {
                    projects, tasks, notebook,
                    project_notes: projectNotes,
                    task_logs: taskLogs,
                    checklist_items: checklistItems,
                    checklist_history: checklistHistory,
                    sleep, workout
                };
                for (const s of this.sections) s.items = byKey[s.key] || [];
            } catch (e) {
                this.errorMsg = 'Could not load Restore: ' + e.message;
            }
            this.loading = false;
        },

        toggleSection(section) {
            section.expanded = !section.expanded;
        },

        // Row label logic per entity -- kept in one place so a new entity
        // just declares its label rule alongside its list function.
        labelOf(section, row) {
            switch (section.key) {
                case 'projects':
                case 'tasks':
                case 'checklist_items':
                    return row.name;
                case 'notebook':
                case 'sleep':
                case 'workout':
                    return row.entry_date;
                case 'project_notes':
                    return this.truncate(row.body, 60);
                case 'task_logs':
                    return `${row.entry_date || ''} — ${this.truncate(row.body, 40)}`;
                case 'checklist_history': {
                    const item = this.checklistItemsById[row.item_id];
                    const name = item ? item.name : `(item ${(row.item_id || '').slice(0, 6)}…)`;
                    return `${row.entry_date} — ${name} — ${row.status}`;
                }
                default:
                    return row.id;
            }
        },
        truncate(s, n) {
            if (!s) return '';
            return s.length > n ? s.slice(0, n) + '…' : s;
        },

        async restoreRow(section, row) {
            try {
                await this.callRestore(section.kind, row.id);
                await this.load();
            } catch (e) {
                this.errorMsg = 'Restore failed: ' + e.message;
            }
        },
        callRestore(kind, id) {
            switch (kind) {
                case 'Projects':         return DB.Projects.restoreFromTrash(id);
                case 'Tasks':            return DB.Tasks.restoreFromTrash(id);
                case 'Notebook':         return DB.Notebook.restoreFromTrash(id);
                case 'ProjectNotes':     return DB.ProjectNotes.restoreFromTrash(id);
                case 'TaskLogs':         return DB.TaskLogs.restoreFromTrash(id);
                case 'ChecklistItems':   return DB.Checklist.restoreItemFromTrash(id);
                case 'ChecklistHistory': return DB.Checklist.restoreHistory(id);
                case 'Sleep':            return DB.Sleep.restoreFromTrash(id);
                case 'Workout':          return DB.Workout.restoreFromTrash(id);
                default: throw new Error(`Unknown restore kind: ${kind}`);
            }
        },

        askHardDeleteRow(section, row) {
            this.confirmingHardDelete = { section, row, label: this.labelOf(section, row) };
        },
        cancelHardDelete() {
            this.confirmingHardDelete = null;
        },
        async confirmHardDelete() {
            const target = this.confirmingHardDelete;
            if (!target) return;
            try {
                await this.callHardDelete(target.section.kind, target.row.id);
                this.confirmingHardDelete = null;
                await this.load();
            } catch (e) {
                this.errorMsg = 'Permanent delete failed: ' + e.message;
            }
        },
        callHardDelete(kind, id) {
            switch (kind) {
                case 'Projects':         return DB.Projects.hardDelete(id);
                case 'Tasks':            return DB.Tasks.hardDelete(id);
                case 'Notebook':         return DB.Notebook.hardDelete(id);
                case 'ProjectNotes':     return DB.ProjectNotes.hardDelete(id);
                case 'TaskLogs':         return DB.TaskLogs.hardDelete(id);
                case 'ChecklistItems':   return DB.Checklist.hardDeleteItem(id);
                case 'ChecklistHistory': return DB.Checklist.hardDeleteHistory(id);
                case 'Sleep':            return DB.Sleep.hardDelete(id);
                case 'Workout':          return DB.Workout.hardDelete(id);
                default: throw new Error(`Unknown hard-delete kind: ${kind}`);
            }
        }
    };
}
