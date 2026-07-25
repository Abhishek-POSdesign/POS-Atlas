import { DB } from '../db.js';
import { getLogicalDate, todayKey } from '../date-utils.js';

function todayIsoDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function minutesToHM(mins) {
    if (mins === null || mins === undefined) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
}

export function todayPage() {
    return {
        tasks: [],
        projects: [],
        loading: true,
        errorMsg: '',

        // ---- daily note (same atlas_notebook_entries table Notebook uses) ----
        noteDate: todayIsoDate(),
        noteEntry: null,
        noteDraft: '',
        noteSaving: false,

        // ---- sleep ----
        sleepEntry: null,
        sleepModalOpen: false,
        sleepForm: { hours: '', minutes: '', score: '', note: '' },

        // ---- workout ----
        workoutEntry: null,
        workoutModalOpen: false,
        workoutForm: { minutes: '', type: '', calories: '', note: '' },

        // ---- streaks ----
        streaks: [],
        relapseTarget: null,
        relapseForm: { reason: '', useGrace: false },
        relapseError: '',

        // ---- add task modal ----
        taskModalOpen: false,
        taskForm: { name: '', kind: 'task', date: '', time: '', projectId: '', notify: false },

        // ---- checklist KPI (today's done/total, for the ring) ----
        checklistDoneToday: 0,
        checklistTotalToday: 0,

        // ---- trend (last 30 days, checklist done/skipped/missed) ----
        trendDays: [],

        async init() {
            await this.load();
        },
        async load() {
            this.loading = true;
            this.errorMsg = '';
            try {
                const today = todayKey();
                const dow = getLogicalDate().getDay();
                const [tasks, projects, noteEntry, sleepEntry, workoutEntry, streaks, checklistItems, checklistHistory] = await Promise.all([
                    DB.Tasks.listActive(),
                    DB.Projects.listActive(),
                    DB.Notebook.getByDate(this.noteDate),
                    DB.Sleep.getByDate(today),
                    DB.Workout.getByDate(today),
                    DB.Targets.listStreaks(),
                    DB.Checklist.listItems(),
                    DB.Checklist.listHistoryForDate(today)
                ]);
                this.tasks = tasks;
                this.projects = projects;
                this.noteEntry = noteEntry;
                this.noteDraft = noteEntry ? noteEntry.body : '';
                this.sleepEntry = sleepEntry;
                this.workoutEntry = workoutEntry;
                this.streaks = streaks;
                const todaysItems = checklistItems.filter(i => !i.days || i.days.includes(dow));
                const doneIds = new Set(checklistHistory.filter(h => h.status === 'done').map(h => h.item_id));
                this.checklistTotalToday = todaysItems.length;
                this.checklistDoneToday = todaysItems.filter(i => doneIds.has(i.id)).length;
                await this.loadTrend();
            } catch (e) {
                this.errorMsg = 'Could not load Today: ' + e.message;
            }
            this.loading = false;
        },
        get upcomingTasks() {
            return this.tasks.filter(t => t.status !== 'done').slice(0, 20);
        },
        get recentlyCompleted() {
            return this.tasks
                .filter(t => t.status === 'done' && t.completed_at)
                .sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1))
                .slice(0, 6);
        },
        get activeProjectCount() {
            return this.projects.length;
        },
        get inProgressProjectCount() {
            return this.projects.filter(p => p.status === 'in_progress').length;
        },
        get checklistPct() {
            return this.checklistTotalToday ? Math.round(this.checklistDoneToday / this.checklistTotalToday * 100) : 0;
        },
        get checklistRemaining() {
            return Math.max(0, this.checklistTotalToday - this.checklistDoneToday);
        },
        get todayLabel() {
            return new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
        },
        projectFor(task) {
            if (!task.project_id) return null;
            return this.projects.find(p => p.id === task.project_id) || null;
        },
        projectInitial(project) {
            return (project.monogram_letter || project.name?.[0] || '?').toUpperCase();
        },

        // ---- streaks ----
        daysFor(streak) {
            const start = new Date(streak.streak_start_date);
            const today = new Date(todayKey());
            return Math.max(0, Math.floor((today - start) / 86400000));
        },
        streakMeta(streak) {
            const days = this.daysFor(streak);
            if (streak.grace_used) return { text: 'Grace day used', grace: true };
            if (streak.previous_best_days && days < streak.previous_best_days) {
                return { text: `Previous best: ${streak.previous_best_days} days`, grace: false };
            }
            return null;
        },
        openRelapseModal(streak) {
            this.relapseTarget = streak;
            this.relapseForm = { reason: '', useGrace: false };
            this.relapseError = '';
        },
        closeRelapseModal() { this.relapseTarget = null; },
        async confirmRelapse() {
            const reason = this.relapseForm.reason.trim();
            if (!reason) { this.relapseError = 'A reason is required.'; return; }
            try {
                const days = this.daysFor(this.relapseTarget);
                const updated = await DB.Targets.logRelapse(this.relapseTarget.id, days, reason, this.relapseForm.useGrace);
                this.streaks = this.streaks.map(s => s.id === updated.id ? updated : s);
                this.relapseTarget = null;
            } catch (e) {
                this.relapseError = e.message;
            }
        },

        // ---- add task ----
        openTaskModal() {
            this.taskForm = { name: '', kind: 'task', date: todayIsoDate(), time: '', projectId: '', notify: false };
            this.taskModalOpen = true;
        },
        closeTaskModal() { this.taskModalOpen = false; },
        async submitTask() {
            const name = this.taskForm.name.trim();
            if (!name) return;
            try {
                const row = await DB.Tasks.create({
                    name,
                    kind: this.taskForm.kind,
                    status: 'not_started',
                    priority: 'normal',
                    project_id: this.taskForm.projectId || null,
                    scheduled_date: this.taskForm.date || null,
                    scheduled_time: this.taskForm.time || null,
                    notify_enabled: this.taskForm.notify
                });
                this.tasks = [...this.tasks, row];
                this.taskModalOpen = false;
            } catch (e) {
                this.errorMsg = e.message;
            }
        },

        // ---- daily note ----
        async saveNote() {
            const body = this.noteDraft.trim();
            if (!body) return;
            this.noteSaving = true;
            try {
                if (this.noteEntry) {
                    this.noteEntry = await DB.Notebook.update(this.noteEntry.id, { body });
                } else {
                    this.noteEntry = await DB.Notebook.create({ entry_date: this.noteDate, body });
                }
            } catch (e) {
                this.errorMsg = e.message;
            }
            this.noteSaving = false;
        },

        // ---- sleep ----
        get sleepSummary() {
            if (!this.sleepEntry) return 'No sleep logged today';
            const parts = [];
            if (this.sleepEntry.duration_minutes != null) parts.push(minutesToHM(this.sleepEntry.duration_minutes));
            if (this.sleepEntry.sleep_score != null) parts.push(`Score ${this.sleepEntry.sleep_score}`);
            return parts.length ? parts.join(' · ') : 'Logged, no details';
        },
        openSleepModal() {
            const h = this.sleepEntry && this.sleepEntry.duration_minutes != null ? Math.floor(this.sleepEntry.duration_minutes / 60) : '';
            const m = this.sleepEntry && this.sleepEntry.duration_minutes != null ? this.sleepEntry.duration_minutes % 60 : '';
            this.sleepForm = {
                hours: h === '' ? '' : String(h),
                minutes: m === '' ? '' : String(m),
                score: this.sleepEntry && this.sleepEntry.sleep_score != null ? String(this.sleepEntry.sleep_score) : '',
                note: (this.sleepEntry && this.sleepEntry.note) || ''
            };
            this.sleepModalOpen = true;
        },
        closeSleepModal() { this.sleepModalOpen = false; },
        async saveSleep() {
            const h = parseInt(this.sleepForm.hours, 10);
            const m = parseInt(this.sleepForm.minutes, 10);
            const score = parseInt(this.sleepForm.score, 10);
            const patch = {
                duration_minutes: (!isNaN(h) || !isNaN(m)) ? ((isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)) : null,
                sleep_score: isNaN(score) ? null : score,
                note: this.sleepForm.note.trim() || null
            };
            try {
                this.sleepEntry = await DB.Sleep.save(todayKey(), patch);
                this.sleepModalOpen = false;
            } catch (e) {
                this.errorMsg = e.message;
            }
        },

        // ---- workout ----
        get workoutSummary() {
            if (!this.workoutEntry) return 'No workout logged today';
            const parts = [];
            if (this.workoutEntry.duration_minutes != null) parts.push(this.workoutEntry.duration_minutes + ' min');
            if (this.workoutEntry.workout_type) parts.push(this.workoutEntry.workout_type);
            return parts.length ? parts.join(' · ') : 'Logged, no details';
        },
        openWorkoutModal() {
            this.workoutForm = {
                minutes: this.workoutEntry && this.workoutEntry.duration_minutes != null ? String(this.workoutEntry.duration_minutes) : '',
                type: (this.workoutEntry && this.workoutEntry.workout_type) || '',
                calories: this.workoutEntry && this.workoutEntry.calories != null ? String(this.workoutEntry.calories) : '',
                note: (this.workoutEntry && this.workoutEntry.note) || ''
            };
            this.workoutModalOpen = true;
        },
        closeWorkoutModal() { this.workoutModalOpen = false; },
        async saveWorkout() {
            const minutes = parseInt(this.workoutForm.minutes, 10);
            const calories = parseInt(this.workoutForm.calories, 10);
            const patch = {
                duration_minutes: isNaN(minutes) ? null : minutes,
                workout_type: this.workoutForm.type.trim() || null,
                calories: isNaN(calories) ? null : calories,
                note: this.workoutForm.note.trim() || null
            };
            try {
                this.workoutEntry = await DB.Workout.save(todayKey(), patch);
                this.workoutModalOpen = false;
            } catch (e) {
                this.errorMsg = e.message;
            }
        },

        // ---- trend: last 30 logical days, checklist done/skipped/missed ----
        async loadTrend() {
            try {
                const items = await DB.Checklist.listItems();
                const end = getLogicalDate();
                const start = new Date(end);
                start.setDate(start.getDate() - 29);
                const fmt = d => d.toLocaleDateString('en-CA');
                const history = await DB.Checklist.listHistoryRange(fmt(start), fmt(end));
                const byDate = {};
                history.forEach(h => {
                    if (!byDate[h.entry_date]) byDate[h.entry_date] = { done: 0, skipped: 0 };
                    if (h.status === 'done') byDate[h.entry_date].done++;
                    else byDate[h.entry_date].skipped++;
                });
                const days = [];
                for (let i = 0; i < 30; i++) {
                    const d = new Date(start);
                    d.setDate(d.getDate() + i);
                    const key = fmt(d);
                    const dow = d.getDay();
                    const total = items.filter(it => !it.days || it.days.includes(dow)).length;
                    const rec = byDate[key] || { done: 0, skipped: 0 };
                    const missed = Math.max(0, total - rec.done - rec.skipped);
                    days.push({ date: key, label: d.getDate(), done: rec.done, skipped: rec.skipped, missed, total: total || 1 });
                }
                this.trendDays = days;
            } catch (e) {
                this.errorMsg = e.message;
            }
        }
    };
}
