import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/+esm';
import { supabase } from '../js/supabase-client.js';
import { DB } from '../js/db.js';

// Same VAPID public key the main Atlas app already uses (js/push-client.js)
// -- one shared key pair for all of Atlas's push infrastructure, this is
// just a different subscriptions table (atlas_family_push_subscriptions)
// for a different device. A public key is safe to duplicate; only the
// private half (server-side only, never shipped to any browser) matters.
const PUBLIC_VAPID_KEY = 'BL12XRcZgRHzKZxumH9Qh-ft0FDAblQSTN7AElr-yqyaNfKraAJtg6CnxJoEE5VIuB2hips3DNfgP14zkEn7Lng';

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

Alpine.data('familyApp', () => ({

    // ── Auth ──────────────────────────────────────────────
    session: null,
    authEmail: '',
    authPassword: '',
    authError: '',
    authLoading: false,

    // ── Data ──────────────────────────────────────────────
    loading: true,
    todayLabel: '',
    todayIso: '',
    note: null,
    checklistItems: [],
    history: [],
    pendingTasks: [],

    // ── Routine modal (add / edit) ─────────────────────────
    showRoutineModal: false,
    routineModalMode: 'add',          // 'add' | 'edit'
    editingRoutineId: null,
    routineForm: { name: '', block: 'Morning' },

    // ── Task modal (add / edit) ────────────────────────────
    showTaskModal: false,
    taskModalMode: 'add',             // 'add' | 'edit'
    editingTaskId: null,
    taskForm: { name: '', scheduled_date: '', reminder_time: '' },

    // ── Reminder ──────────────────────────────────────────
    reminderInterval: null,

    // ── Push notifications (2026-08-07) ───────────────────
    // Real push, not just the in-tab Notification calls below (those only
    // ever fire while a tab is actually open). Off by default -- browsers
    // require a direct user tap to subscribe, so this can't be silent.
    familyPushStatus: 'Checking…',
    familyPushEnabled: false,

    // ─────────────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────────────
    async init() {
        const { data: { session } } = await supabase.auth.getSession();
        this.session = session;

        supabase.auth.onAuthStateChange((_event, session) => {
            this.session = session;
            if (session) this.load();
            else this.loading = false;
        });

        if (this.session) await this.load();
        else this.loading = false;

        // Ask for notification permission on first open
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
        this.setupReminder();
        this.checkFamilyPushStatus();
    },

    // ─────────────────────────────────────────────────────
    // PUSH NOTIFICATIONS
    // ─────────────────────────────────────────────────────
    async checkFamilyPushStatus() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            this.familyPushStatus = 'Not supported on this device';
            return;
        }
        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            this.familyPushEnabled = !!subscription;
            this.familyPushStatus = subscription ? 'On' : 'Off';
        } catch (e) {
            console.error('Push status check failed:', e);
            this.familyPushStatus = 'Off';
        }
    },
    async toggleFamilyPush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        this.familyPushStatus = 'Working…';
        try {
            const registration = await navigator.serviceWorker.ready;
            const existing = await registration.pushManager.getSubscription();
            if (existing) {
                await DB.Family.removePushSubscription(existing.endpoint);
                await existing.unsubscribe();
                this.familyPushEnabled = false;
                this.familyPushStatus = 'Off';
            } else {
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
                });
                const subJson = subscription.toJSON();
                await DB.Family.savePushSubscription({ endpoint: subJson.endpoint, p256dh: subJson.keys.p256dh, auth: subJson.keys.auth });
                this.familyPushEnabled = true;
                this.familyPushStatus = 'On';
            }
        } catch (e) {
            console.error('Push toggle failed:', e);
            // Inline status text, not a browser alert -- same fix applied
            // to Abhishek's note-send error this same session.
            this.familyPushStatus = 'Could not enable: ' + (e.message || 'try again');
        }
    },

    // ─────────────────────────────────────────────────────
    // AUTH
    // ─────────────────────────────────────────────────────
    async login() {
        this.authError = '';
        this.authLoading = true;
        try {
            const { error } = await supabase.auth.signInWithPassword({
                email: this.authEmail,
                password: this.authPassword
            });
            if (error) throw error;
        } catch (e) {
            this.authError = e.message;
        } finally {
            this.authLoading = false;
        }
    },

    // ─────────────────────────────────────────────────────
    // DATA LOAD
    // ─────────────────────────────────────────────────────
    async load() {
        this.loading = true;
        this.setToday();
        try {
            const [items, hist, tasks, nt] = await Promise.all([
                DB.Family.listChecklistItems(),
                DB.Family.listChecklistHistoryForDate(this.todayIso),
                DB.Family.listTasks(),
                DB.Family.getNote()
            ]);
            this.checklistItems = items;
            this.history = hist;
            this.pendingTasks = tasks;
            this.note = nt;
        } catch (e) {
            console.error('Failed to load family data:', e);
        }
        this.loading = false;
    },

    setToday() {
        const d = new Date();
        this.todayIso = d.toISOString().split('T')[0];
        this.todayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    },

    // ─────────────────────────────────────────────────────
    // NOTE
    // ─────────────────────────────────────────────────────
    async dismissNote() {
        try {
            await DB.Family.markNoteRead();
            this.note.is_read = true;
        } catch (e) {
            console.error('Could not dismiss note:', e);
        }
    },

    // ─────────────────────────────────────────────────────
    // ROUTINE – checklist status
    // ─────────────────────────────────────────────────────
    getItemStatus(itemId) {
        const entry = this.history.find(h => h.item_id === itemId);
        return entry ? entry.status : null;
    },

    async setItemStatus(itemId, status) {
        // Toggle: tapping same status again clears it back to pending
        const current = this.getItemStatus(itemId);
        const newStatus = current === status ? null : status;

        // Optimistic update
        const idx = this.history.findIndex(h => h.item_id === itemId);
        if (newStatus === null) {
            if (idx > -1) this.history.splice(idx, 1);
        } else {
            if (idx > -1) this.history[idx].status = newStatus;
            else this.history.push({ item_id: itemId, status: newStatus, entry_date: this.todayIso });
        }

        try {
            if (newStatus === null) {
                // Remove history row
                await supabase
                    .from('atlas_family_checklist_history')
                    .delete()
                    .eq('item_id', itemId)
                    .eq('entry_date', this.todayIso);
            } else {
                await DB.Family.setChecklistStatus(itemId, this.todayIso, newStatus);
            }
        } catch (e) {
            console.error('Failed to update status:', e);
            await this.load();
        }
    },

    // ─────────────────────────────────────────────────────
    // ROUTINE – CRUD
    // ─────────────────────────────────────────────────────
    openAddRoutine() {
        this.routineModalMode = 'add';
        this.editingRoutineId = null;
        this.routineForm = { name: '', block: 'Morning' };
        this.showRoutineModal = true;
    },

    openEditRoutine(item) {
        this.routineModalMode = 'edit';
        this.editingRoutineId = item.id;
        this.routineForm = { name: item.name, block: item.block };
        this.showRoutineModal = true;
    },

    async saveRoutineItem() {
        if (!this.routineForm.name.trim()) return;
        try {
            if (this.routineModalMode === 'add') {
                await DB.Family.createChecklistItem({
                    name: this.routineForm.name.trim(),
                    block: this.routineForm.block,
                    active: true,
                    order_index: this.checklistItems.length
                });
            } else {
                await DB.Family.updateChecklistItem(this.editingRoutineId, {
                    name: this.routineForm.name.trim(),
                    block: this.routineForm.block
                });
            }
            this.showRoutineModal = false;
            await this.load();
        } catch (e) {
            console.error('Failed to save routine item:', e);
        }
    },

    async deleteRoutineItem(id) {
        if (!confirm('Remove this routine item? This will also delete its history.')) return;
        try {
            await DB.Family.deleteChecklistItem(id);
            this.showRoutineModal = false;
            await this.load();
        } catch (e) {
            console.error('Failed to delete routine item:', e);
        }
    },

    // ─────────────────────────────────────────────────────
    // TASKS – CRUD
    // ─────────────────────────────────────────────────────
    openAddTask() {
        this.taskModalMode = 'add';
        this.editingTaskId = null;
        this.taskForm = { name: '', scheduled_date: '', reminder_time: '' };
        this.showTaskModal = true;
    },

    openEditTask(task) {
        this.taskModalMode = 'edit';
        this.editingTaskId = task.id;
        this.taskForm = {
            name: task.name,
            scheduled_date: task.scheduled_date || '',
            reminder_time: task.reminder_time || ''
        };
        this.showTaskModal = true;
    },

    async saveTask() {
        if (!this.taskForm.name.trim()) return;
        const payload = {
            name: this.taskForm.name.trim(),
            scheduled_date: this.taskForm.scheduled_date || null,
            reminder_time: this.taskForm.reminder_time || null,
            status: 'pending'
        };
        try {
            if (this.taskModalMode === 'add') {
                await DB.Family.createTask(payload);
            } else {
                delete payload.status; // don't overwrite status on edit
                await DB.Family.updateTask(this.editingTaskId, payload);
            }
            this.showTaskModal = false;
            await this.load();
            // Re-schedule reminders if a reminder_time changed
            this.scheduleTaskReminders();
        } catch (e) {
            console.error('Failed to save task:', e);
        }
    },

    async completeTask(taskId) {
        this.pendingTasks = this.pendingTasks.filter(t => t.id !== taskId);
        try {
            await DB.Family.completeTask(taskId);
        } catch (e) {
            console.error('Failed to complete task:', e);
            await this.load();
        }
    },

    async deleteTask(taskId) {
        if (!confirm('Delete this task?')) return;
        this.pendingTasks = this.pendingTasks.filter(t => t.id !== taskId);
        try {
            await DB.Family.deleteTask(taskId);
        } catch (e) {
            console.error('Failed to delete task:', e);
            await this.load();
        }
    },

    // ─────────────────────────────────────────────────────
    // DISPLAY HELPERS
    // ─────────────────────────────────────────────────────
    formatDate(iso) {
        if (!iso) return '';
        const d = new Date(iso + 'T00:00:00');
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    },

    formatTime(t) {
        if (!t) return '';
        const [h, m] = t.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    },

    // ─────────────────────────────────────────────────────
    // REMINDERS
    // ─────────────────────────────────────────────────────
    setupReminder() {
        if (this.reminderInterval) clearInterval(this.reminderInterval);
        // Check every minute for task reminders + the nightly summary
        this.reminderInterval = setInterval(() => {
            this.checkReminder();
            this.scheduleTaskReminders();
        }, 60 * 1000);
        this.checkReminder();
        this.scheduleTaskReminders();
    },

    checkReminder() {
        // Nightly summary at 21:00
        const now = new Date();
        if (now.getHours() >= 21) {
            const todayKey = now.toISOString().split('T')[0];
            if (localStorage.getItem('familyNightlyReminderDate') !== todayKey) {
                this.sendNightlyNotification();
                localStorage.setItem('familyNightlyReminderDate', todayKey);
            }
        }
    },

    scheduleTaskReminders() {
        // Fire a notification for any task whose reminder_time matches the current HH:MM
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const now = new Date();
        const nowHHMM = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

        this.pendingTasks.forEach(task => {
            if (!task.reminder_time) return;
            const taskTime = task.reminder_time.slice(0, 5); // "HH:MM"
            if (taskTime !== nowHHMM) return;

            const sentKey = `familyTaskReminder_${task.id}_${this.todayIso}`;
            if (localStorage.getItem(sentKey)) return;

            new Notification('📌 Task Reminder', {
                body: task.name + (task.scheduled_date ? ` — due ${this.formatDate(task.scheduled_date)}` : ''),
                icon: '/apple-touch-icon.png'
            });
            localStorage.setItem(sentKey, '1');
        });
    },

    sendNightlyNotification() {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const doneIds = new Set(this.history.filter(h => h.status === 'done').map(h => h.item_id));
        const total = this.checklistItems.length;
        const done = this.checklistItems.filter(i => doneIds.has(i.id)).length;
        new Notification('🌙 Atlas Daily Summary', {
            body: `${done} of ${total} routine items done today. ${this.pendingTasks.length} tasks still pending.`,
            icon: '/apple-touch-icon.png'
        });
    }
}));

window.Alpine = Alpine;
Alpine.start();

// Register family-scoped service worker for PWA install
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/family/service-worker.js', {
            scope: '/family/',
            updateViaCache: 'none'
        }).catch(err => console.error('Family SW registration failed:', err));
    });
}
