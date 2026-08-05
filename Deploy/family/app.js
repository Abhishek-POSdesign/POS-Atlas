import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/+esm';
import { supabase } from '../js/supabase-client.js';
import { DB } from '../js/db.js';

Alpine.data('familyApp', () => ({
        session: null,
        authEmail: '',
        authPassword: '',
        authError: '',
        loading: true,
        
        todayLabel: '',
        todayIso: '',
        
        note: null,
        checklistItems: [],
        history: [],
        pendingTasks: [],
        
        showTaskModal: false,
        newTask: { name: '' },
        
        showRoutineModal: false,
        newRoutine: { name: '', block: 'Morning' },
        
        reminderInterval: null,

        async init() {
            // Check existing session
            const { data: { session } } = await supabase.auth.getSession();
            this.session = session;
            
            // Set up auth state listener
            supabase.auth.onAuthStateChange((event, session) => {
                this.session = session;
                if (session) this.load();
            });

            if (this.session) {
                await this.load();
            }
            
            // Notification setup
            if ('Notification' in window) {
                Notification.requestPermission();
            }
            this.setupReminder();
        },

        async login() {
            this.authError = '';
            try {
                const { error } = await supabase.auth.signInWithPassword({
                    email: this.authEmail,
                    password: this.authPassword
                });
                if (error) throw error;
            } catch (e) {
                this.authError = e.message;
            }
        },

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
                console.error("Failed to load family data:", e);
            }
            
            this.loading = false;
        },

        setToday() {
            const d = new Date();
            this.todayIso = d.toISOString().split('T')[0];
            const opts = { weekday: 'long', month: 'short', day: 'numeric' };
            this.todayLabel = d.toLocaleDateString('en-US', opts);
        },

        formatDate(iso) {
            if (!iso) return '';
            const d = new Date(iso);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        },

        async dismissNote() {
            try {
                await DB.Family.markNoteRead();
                this.note.is_read = true;
            } catch (e) {
                console.error("Could not dismiss note", e);
            }
        },

        getItemStatus(itemId) {
            const entry = this.history.find(h => h.item_id === itemId);
            return entry ? entry.status : 'pending';
        },

        async setItemStatus(itemId, status) {
            // Optimistic update
            let entry = this.history.find(h => h.item_id === itemId);
            if (entry) {
                entry.status = status;
            } else {
                this.history.push({ item_id: itemId, status: status, entry_date: this.todayIso });
            }

            try {
                await DB.Family.setChecklistStatus(itemId, this.todayIso, status);
            } catch (e) {
                console.error("Failed to update status", e);
                this.load(); // rollback on failure
            }
        },

        async addRoutineItem() {
            if (!this.newRoutine.name.trim()) return;
            const payload = {
                name: this.newRoutine.name.trim(),
                block: this.newRoutine.block,
                active: true,
                order_index: this.checklistItems.length
            };
            try {
                await DB.Family.createChecklistItem(payload);
                this.newRoutine.name = '';
                this.showRoutineModal = false;
                await this.load();
            } catch (e) {
                console.error("Failed to add routine item", e);
            }
        },

        async addTask() {
            if (!this.newTask.name.trim()) return;
            const payload = {
                name: this.newTask.name.trim(),
                status: 'pending'
            };
            try {
                await DB.Family.createTask(payload);
                this.newTask.name = '';
                this.showTaskModal = false;
                await this.load();
            } catch (e) {
                console.error("Failed to add task", e);
            }
        },

        async completeTask(taskId) {
            // Optimistic update
            this.pendingTasks = this.pendingTasks.filter(t => t.id !== taskId);
            try {
                await DB.Family.completeTask(taskId);
            } catch (e) {
                console.error("Failed to complete task", e);
                this.load(); // rollback on failure
            }
        },

        setupReminder() {
            // Check every 5 minutes if it's time to send the reminder
            if (this.reminderInterval) clearInterval(this.reminderInterval);
            this.reminderInterval = setInterval(() => this.checkReminder(), 5 * 60 * 1000);
            
            // Also check immediately in case the app was opened right at/after 21:00
            this.checkReminder();
        },

        checkReminder() {
            const now = new Date();
            const hours = now.getHours();
            
            // Check if it's 9 PM (21:00) or later
            if (hours >= 21) {
                const todayKey = now.toISOString().split('T')[0];
                const lastSentDate = localStorage.getItem('familyReminderSentDate');
                
                if (lastSentDate !== todayKey) {
                    // Send it
                    this.sendLocalNotification();
                    localStorage.setItem('familyReminderSentDate', todayKey);
                }
            }
        },

        sendLocalNotification() {
            if (!('Notification' in window) || Notification.permission !== 'granted') {
                return;
            }
            
            // Calculate summary for the notification body
            const blocks = { morning: {t:0,d:0}, afternoon: {t:0,d:0}, evening: {t:0,d:0}, sleep: {t:0,d:0} };
            const doneIds = new Set(this.history.filter(h => h.status === 'done').map(h => h.item_id));

            this.checklistItems.forEach(i => {
                const block = (i.block || '').toLowerCase();
                if (blocks[block]) {
                    blocks[block].t++;
                    if (doneIds.has(i.id)) blocks[block].d++;
                }
            });

            const body = `Morning: ${blocks.morning.d}/${blocks.morning.t} | Afternoon: ${blocks.afternoon.d}/${blocks.afternoon.t} | Evening: ${blocks.evening.d}/${blocks.evening.t}`;
            
            new Notification("Atlas Daily Summary", {
                body: body,
                icon: '/apple-touch-icon.png' // Adjust if needed
            });
        }
    }));

window.Alpine = Alpine;
Alpine.start();
