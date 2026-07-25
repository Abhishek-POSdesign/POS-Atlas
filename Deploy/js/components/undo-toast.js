// Single toast host, mounted once in index.html. Any page calls
// showUndoToast() after a soft-delete -- it doesn't need to know how or
// where the toast renders. The undo itself is a real database write
// (passed in as onUndo), so it survives a page refresh even if the toast
// visually disappears first.

const listeners = new Set();

export function showUndoToast(message, onUndo) {
    const id = crypto.randomUUID();
    const toast = { id, message, onUndo };
    for (const fn of listeners) fn({ type: 'add', toast });
    setTimeout(() => {
        for (const fn of listeners) fn({ type: 'remove', id });
    }, 8000);
}

export function undoToastHost() {
    return {
        toasts: [],
        init() {
            listeners.add((evt) => {
                if (evt.type === 'add') this.toasts.push(evt.toast);
                else this.toasts = this.toasts.filter(t => t.id !== evt.id);
            });
        },
        async undo(toast) {
            this.toasts = this.toasts.filter(t => t.id !== toast.id);
            try {
                await toast.onUndo();
            } catch (e) {
                console.error('Undo failed', e);
            }
        }
    };
}
