import { DB } from '../db.js';
import { getLogicalDate, todayKey } from '../date-utils.js';
import { BLOCKS } from '../checklist-blocks.js';

export function checklistPage() {
    return {
        loading: true,
        errorMsg: '',
        items: [],
        historyByItem: {}, // item_id -> today's history row
        today: '',
        blocks: BLOCKS,

        managing: false,
        addingToBlock: null,
        addForm: { name: '', icon: '' },
        editingItemId: null,
        editForm: { name: '', block: '', icon: '' },

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
        doneCountForBlock(blockKey) {
            return this.itemsForBlock(blockKey).filter(i => this.statusFor(i) === 'done').length;
        },
        get totalDoneToday() {
            return this.items.filter(i => this.statusFor(i) === 'done').length;
        },

        async mark(item, status) {
            const current = this.statusFor(item);
            if (current === status) return this.undoMark(item);
            try {
                const row = await DB.Checklist.setStatus(item.id, this.today, status);
                this.historyByItem = { ...this.historyByItem, [item.id]: row };
            } catch (e) {
                this.errorMsg = e.message;
            }
        },
        async undoMark(item) {
            const h = this.historyByItem[item.id];
            if (!h) return;
            try {
                await DB.Checklist.undoStatus(h.id);
                const copy = { ...this.historyByItem };
                delete copy[item.id];
                this.historyByItem = copy;
            } catch (e) {
                this.errorMsg = e.message;
            }
        },

        // ---- management ----
        toggleManaging() { this.managing = !this.managing; this.addingToBlock = null; this.editingItemId = null; },

        openAdd(blockKey) {
            this.addForm = { name: '', icon: '' };
            this.addingToBlock = blockKey;
        },
        cancelAdd() { this.addingToBlock = null; },
        async submitAdd() {
            if (!this.addForm.name.trim()) return;
            try {
                const maxOrder = this.items.reduce((m, i) => Math.max(m, i.order_index), -1);
                await DB.Checklist.createItem({
                    name: this.addForm.name.trim(),
                    block: this.addingToBlock,
                    icon: this.addForm.icon.trim() || '📋',
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
            this.editForm = { name: item.name, block: item.block, icon: item.icon || '' };
        },
        cancelEditItem() { this.editingItemId = null; },
        async saveEditItem(item) {
            if (!this.editForm.name.trim()) return;
            try {
                await DB.Checklist.updateItem(item.id, {
                    name: this.editForm.name.trim(),
                    block: this.editForm.block,
                    icon: this.editForm.icon.trim() || '📋'
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
