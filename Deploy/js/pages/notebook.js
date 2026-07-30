import { DB } from '../db.js';
import { showUndoToast } from '../components/undo-toast.js';
import { askConfirm } from '../components/confirm-dialog.js';
import { todayIsoDate } from '../date-utils.js';

export function notebookPage(nav) {
    return {
        entries: [],
        loading: true,
        errorMsg: '',
        draft: '',
        savedState: 'draft', // 'draft', 'saving', 'saved'
        todayEntry: null,
        // Midnight calendar date -- notebook entries are not a checklist habit,
        // they don't roll over on the 6am boundary (locked 2026-07-26).
        todayDate: todayIsoDate(),
        async init() {
            await this.load();
        },
        async load() {
            this.loading = true;
            this.errorMsg = '';
            try {
                this.entries = await DB.Notebook.listRecent(30);
                this.todayEntry = this.entries.find(e => e.entry_date === this.todayDate) || null;
                this.draft = this.todayEntry ? this.todayEntry.body : '';
            } catch (e) {
                this.errorMsg = 'Could not load notebook: ' + e.message;
            }
            this.loading = false;
        },
        async save() {
            const body = this.draft.trim();
            if (!body) return;
            this.savedState = 'saving';
            try {
                if (this.todayEntry) {
                    const updated = await DB.Notebook.update(this.todayEntry.id, { body });
                    this.entries = this.entries.map(e => e.id === updated.id ? updated : e);
                    this.todayEntry = updated;
                } else {
                    const created = await DB.Notebook.create({ entry_date: this.todayDate, body });
                    this.entries = [created, ...this.entries];
                    this.todayEntry = created;
                }
                this.savedState = 'saved';
            } catch (e) {
                this.errorMsg = 'Save failed: ' + e.message;
                this.savedState = 'draft';
            }
        },
        get pastEntries() {
            return this.entries.filter(e => e.entry_date !== this.todayDate);
        },
        // Past entries collapse to a compact preview row by default, expand
        // in place on click (2026-07-31, Phase 2 -- mockup-approved). Reuses
        // the same click-to-expand idea the Project card already uses,
        // rather than showing every entry's full body all the time -- a
        // two-sentence entry from last week used to cost the same vertical
        // space as a long one. Plain object keyed by entry id (not a Set)
        // so it's directly usable from x-show/:class in the template.
        expandedEntries: {},
        isEntryExpanded(entry) { return !!this.expandedEntries[entry.id]; },
        toggleEntry(entry) {
            this.expandedEntries = { ...this.expandedEntries, [entry.id]: !this.expandedEntries[entry.id] };
        },
        entryPreview(body) {
            const oneLine = (body || '').replace(/\s+/g, ' ').trim();
            return oneLine.length > 80 ? oneLine.slice(0, 80) + '…' : oneLine;
        },
        close() {
            nav.onClose();
        },
        async deleteEntry(entry) {
            const ok = await askConfirm(`Delete the notebook entry from ${entry.entry_date}? You can restore it from the Restore view afterward.`);
            if (!ok) return;
            const snapshot = this.entries;
            this.entries = this.entries.filter(e => e.id !== entry.id);
            try {
                await DB.Notebook.softDelete(entry.id);
                showUndoToast(`Deleted notebook entry from ${entry.entry_date}`, async () => {
                    await DB.Notebook.restoreFromTrash(entry.id);
                    await this.load();
                });
                if (this.todayEntry && this.todayEntry.id === entry.id) {
                    this.todayEntry = null;
                    this.draft = '';
                }
            } catch (e) {
                this.entries = snapshot;
                this.errorMsg = 'Delete failed: ' + e.message;
            }
        }
    };
}
