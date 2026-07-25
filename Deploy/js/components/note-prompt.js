// Single note-prompt host, mounted once in index.html -- same singleton
// pattern as confirm-dialog.js / undo-toast.js. Used wherever the app wants
// an optional short note from the user (starting or completing a task)
// instead of the browser's native prompt().

const listeners = new Set();

export function askNote(message, options = {}) {
    return new Promise((resolve) => {
        const dialog = {
            id: crypto.randomUUID(),
            message,
            placeholder: options.placeholder || 'Optional note…',
            value: '',
            submitLabel: options.submitLabel || 'Save',
            skipLabel: options.skipLabel || 'Skip',
            resolve
        };
        for (const fn of listeners) fn({ type: 'show', dialog });
    });
}

export function notePromptHost() {
    return {
        dialog: null,
        init() {
            listeners.add((evt) => {
                if (evt.type === 'show') this.dialog = evt.dialog;
            });
        },
        submit() {
            if (!this.dialog) return;
            const v = this.dialog.value.trim();
            this.dialog.resolve(v || null);
            this.dialog = null;
        },
        skip() {
            if (!this.dialog) return;
            this.dialog.resolve(null);
            this.dialog = null;
        }
    };
}
