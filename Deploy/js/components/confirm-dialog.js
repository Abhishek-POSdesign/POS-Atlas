// Single confirm-dialog host, mounted once in index.html -- same singleton
// pattern as undo-toast.js. Any page calls askConfirm() and awaits a real
// boolean, instead of the browser's native confirm()/prompt() (calm in-app
// UI, not a browser popup).

const listeners = new Set();

export function askConfirm(message, options = {}) {
    return new Promise((resolve) => {
        const dialog = {
            id: crypto.randomUUID(),
            message,
            confirmLabel: options.confirmLabel || 'Delete',
            cancelLabel: options.cancelLabel !== undefined ? options.cancelLabel : 'Cancel',
            isDanger: options.isDanger !== undefined ? options.isDanger : true,
            resolve
        };
        for (const fn of listeners) fn({ type: 'show', dialog });
    });
}

export function confirmDialogHost() {
    return {
        dialog: null,
        init() {
            listeners.add((evt) => {
                if (evt.type === 'show') this.dialog = evt.dialog;
            });
        },
        respond(result) {
            if (!this.dialog) return;
            this.dialog.resolve(result);
            this.dialog = null;
        }
    };
}
