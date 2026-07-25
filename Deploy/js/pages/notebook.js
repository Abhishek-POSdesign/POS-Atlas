import { DB } from '../db.js';
import { showUndoToast } from '../components/undo-toast.js';
import { askConfirm } from '../components/confirm-dialog.js';

function todayIsoDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function notebookPage(nav) {
    return {
        entries: [],
        loading: true,
        errorMsg: '',
        draft: '',
        savedState: 'draft', // 'draft', 'saving', 'saved'
        todayEntry: null,
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
