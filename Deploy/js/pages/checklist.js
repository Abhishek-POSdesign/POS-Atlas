import { DB } from '../db.js';
import { getLogicalDate, todayKey } from '../date-utils.js';
import { BLOCKS } from '../checklist-blocks.js';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function nowHHMM() {
    const n = new Date();
    return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
}

export function checklistPage() {
    return {
        loading: true,
        errorMsg: '',
        items: [],
        historyByItem: {}, // item_id -> today's history row
        today: '',
        blocks: BLOCKS,
        // Collapsed by default on every fresh mount (2026-07-26 polish pass).
        // Explicitly session-only -- never persisted to localStorage, so a
        // hard-refresh always starts the routine calmly closed. Toggling a
        // block just flips the in-memory boolean for the rest of the session.
        collapsedBlocks: { morning: true, afternoon: true, night: true, sleep: true },
        dayNames: DAY_NAMES,

        managing: false,
        addingToBlock: null,
        addForm: { name: '', icon: '', days: [] },
        editingItemId: null,
        editForm: { name: '', block: '', icon: '', days: [] },

        logItem: null,
        logForm: { time: '', note: '' },

        async init() {
            await this.load();
        },

        async load() {
            this.loading = true;
            this.errorMsg = '';
            try {
                this.today = todayKey();
                const [items, history] = await Promise.all([
                    DB.Checklist.listItems(),
                    DB.Checklist.listHistoryForDate(this.today)
                ]);
                this.items = items;
                const map = {};
                history.forEach(h => { map[h.item_id] = h; });
                this.historyByItem = map;
            } catch (e) {
                this.errorMsg = 'Could not load Checklist: ' + e.message;
            }
            this.loading = false;
        },

        // In manage mode every item for the block is shown, regardless of day
        // restriction, so a Sunday-only item is still editable on a Tuesday.
        // Outside manage mode, only items that apply today are shown to mark.
        itemsForBlock(blockKey) {
            const all = this.items.filter(i => i.block === blockKey);
            if (this.managing) return all;
            const dow = getLogicalDate().getDay();
            return all.filter(i => !i.days || i.days.includes(dow));
        },
        statusFor(item) {
            const h = this.historyByItem[item.id];
            return h ? h.status : null;
        },
        statusLabel(item) {
            const h = this.historyByItem[item.id];
            if (!h) return 'Pending';
            if (h.status === 'done') return 'Done' + (h.logged_time ? ' • ' + window.formatTime12h(h.logged_time) : '');
            if (h.status === 'skipped') return 'Skipped';
            if (h.status === 'holiday') return 'Holiday';
            return 'Pending';
        },
        doneCountForBlock(blockKey) {
            return this.itemsForBlock(blockKey).filter(i => this.statusFor(i) === 'done').length;
        },
        blockProgress(blockKey) {
            const items = this.itemsForBlock(blockKey);
            if (!items.length) return 0;
            return Math.round(this.doneCountForBlock(blockKey) / items.length * 100);
        },
        get totalDoneToday() {
            return this.items.filter(i => this.statusFor(i) === 'done').length;
        },

        toggleBlock(blockKey) {
            this.collapsedBlocks = { ...this.collapsedBlocks, [blockKey]: !this.collapsedBlocks[blockKey] };
        },

        // ---- Log popup: time + optional note, then Done/Skip/Holiday/Undo ----
        openLog(item) {
            const h = this.historyByItem[item.id];
            this.logItem = item;
            this.logForm = {
                time: (h && h.logged_time) ? h.logged_time.slice(0, 5) : nowHHMM(),
                note: (h && h.note) || ''
            };
        },
        closeLog() { this.logItem = null; },
        async confirmLog(status) {
            if (!this.logItem) return;
            const item = this.logItem;
            try {
                const extra = { note: this.logForm.note.trim() };
                if (status === 'done' || status === 'holiday') extra.loggedTime = this.logForm.time;
                const row = await DB.Checklist.setStatus(item.id, this.today, status, extra);
                this.historyByItem = { ...this.historyByItem, [item.id]: row };
                this.closeLog();
                // Today's own checklist KPI ring (checklistDoneToday/etc.) lives in a
                // separate Alpine component and only reads this data at its own load()
                // time -- without this, the ring stayed frozen until a manual reload
                // even though the mark above saved correctly (2026-07-31 correction
                // pass). Reuses the same event today.js already listens for elsewhere.
                window.dispatchEvent(new CustomEvent('atlas:data-changed'));
            } catch (e) {
                this.errorMsg = e.message;
            }
        },
        async clearLog() {
            if (!this.logItem) return;
            const h = this.historyByItem[this.logItem.id];
            if (!h) { this.closeLog(); return; }
            try {
                await DB.Checklist.undoStatus(h.id);
                const copy = { ...this.historyByItem };
                delete copy[this.logItem.id];
                this.historyByItem = copy;
                this.closeLog();
                window.dispatchEvent(new CustomEvent('atlas:data-changed'));
            } catch (e) {
                this.errorMsg = e.message;
            }
        },

        // ---- management ----
        toggleManaging() { this.managing = !this.managing; this.addingToBlock = null; this.editingItemId = null; },

        openAdd(blockKey) {
            this.addForm = { name: '', icon: '', days: [] };
            this.addingToBlock = blockKey;
        },
        cancelAdd() { this.addingToBlock = null; },
        toggleAddDay(day) {
            this.addForm.days = this.addForm.days.includes(day)
                ? this.addForm.days.filter(d => d !== day)
                : [...this.addForm.days, day];
        },
        async submitAdd() {
            if (!this.addForm.name.trim()) return;
            try {
                const maxOrder = this.items.reduce((m, i) => Math.max(m, i.order_index), -1);
                await DB.Checklist.createItem({
                    name: this.addForm.name.trim(),
                    block: this.addingToBlock,
                    icon: this.addForm.icon.trim() || '📋',
                    days: this.addForm.days.length ? this.addForm.days : null,
                    order_index: maxOrder + 1,
                    active: true
                });
                this.addingToBlock = null;
                await this.load();
            } catch (e) {
                this.errorMsg = e.message;
            }
        },

        startEditItem(item) {
            this.editingItemId = item.id;
            this.editForm = { name: item.name, block: item.block, icon: item.icon || '', days: item.days ? [...item.days] : [] };
        },
        cancelEditItem() { this.editingItemId = null; },
        toggleEditDay(day) {
            this.editForm.days = this.editForm.days.includes(day)
                ? this.editForm.days.filter(d => d !== day)
                : [...this.editForm.days, day];
        },
        async saveEditItem(item) {
            if (!this.editForm.name.trim()) return;
            try {
                await DB.Checklist.updateItem(item.id, {
                    name: this.editForm.name.trim(),
                    block: this.editForm.block,
                    icon: this.editForm.icon.trim() || '📋',
                    days: this.editForm.days.length ? this.editForm.days : null
                });
                this.editingItemId = null;
                await this.load();
            } catch (e) {
                this.errorMsg = e.message;
            }
        },
        async archiveItem(item) {
            try {
                await DB.Checklist.archiveItem(item.id);
                await this.load();
            } catch (e) {
                this.errorMsg = e.message;
            }
        },
        async moveItem(item, dir) {
            const blockItems = this.itemsForBlock(item.block);
            const idx = blockItems.findIndex(i => i.id === item.id);
            const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
            if (swapIdx < 0 || swapIdx >= blockItems.length) return;
            const other = blockItems[swapIdx];
            try {
                await Promise.all([
                    DB.Checklist.updateItem(item.id, { order_index: other.order_index }),
                    DB.Checklist.updateItem(other.id, { order_index: item.order_index })
                ]);
                await this.load();
            } catch (e) {
                this.errorMsg = e.message;
            }
        }
    };
}
