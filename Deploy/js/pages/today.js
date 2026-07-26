import { DB } from '../db.js';
import { getLogicalDate, todayKey, todayIsoDate } from '../date-utils.js';

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
        // Hidden by default -- a small toggle near the header opens/closes it, rather than
        // a permanent card taking up space at the bottom of the page (2026-07-25 feedback).
        // Midnight calendar date, same as the Notebook overlay -- see date-rule split in
        // CLAUDE.md (locked 2026-07-26). Was regressed onto todayKey() briefly and reverted.
        noteDate: todayIsoDate(),
        noteEntry: null,
        noteDraft: '',
        noteSaving: false,
        journalOpen: false,

        // ---- sleep ----
        sleepEntry: null,
        sleepModalOpen: false,
        sleepForm: { hours: '', minutes: '', score: '', deep: '', rem: '', restingHr: '', hrv: '', note: '' },

        // ---- workout ----
        workoutEntry: null,
        workoutModalOpen: false,
        workoutForm: { minutes: '', type: '', score: '', calories: '', vo2Max: '', note: '' },

        // ---- streaks ----
        streaks: [],
        relapseTarget: null,
        relapseForm: { reason: '', useGrace: false },
        relapseError: '',

        // ---- add / edit task modal ----
        // editingTaskId null = create; a uuid = edit that row in place. Both
        // paths share the same modal markup and the same submitTask() below.
        taskModalOpen: false,
        editingTaskId: null,
        taskForm: { name: '', kind: 'task', date: '', time: '', projectId: '', notify: false },

        // ---- checklist KPI (today's done/total, for the ring) ----
        checklistDoneToday: 0,
        checklistTotalToday: 0,
        checklistSkippedToday: 0,

        // ---- trend (last 30 days, checklist done/skipped/missed) ----
        trendDays: [],

        async init() {
            await this.load();
        },
        async load() {
            this.loading = true;
            this.errorMsg = '';
            try {
                // Checklist uses the 6am-shifted logical date (habit rollover).
                // Sleep, workout, journal, tasks, projects all use the plain
                // midnight calendar date -- Abhishek's explicit rule (2026-07-26):
                // the 6am rule is *only* for checklist-style end-of-day habits.
                const checklistDate = todayKey();
                const calendarDate = todayIsoDate();
                const dow = getLogicalDate().getDay();
                
                // For Dashboard lag optimization, we can pull the trend load out of the blocking Promise.all.
                // We'll address that in the lag optimization step. For now, just fix the checklist math.
                
                // noteEntry is hidden by default behind the journalOpen toggle, so it can load asynchronously without flashing
                DB.Notebook.getByDate(this.noteDate).then(entry => {
                    this.noteEntry = entry;
                    this.noteDraft = entry ? entry.body : '';
                }).catch(console.error);

                const [tasks, projects, sleepEntry, workoutEntry, streaks, checklistItems, checklistHistory] = await Promise.all([
                    DB.Tasks.listActive(),
                    DB.Projects.listActive(),
                    DB.Sleep.getByDate(calendarDate),
                    DB.Workout.getByDate(calendarDate),
                    DB.Targets.listStreaks(),
                    DB.Checklist.listItems(),
                    DB.Checklist.listHistoryForDate(checklistDate)
                ]);
                this.tasks = tasks;
                this.projects = projects;
                this.sleepEntry = sleepEntry;
                this.workoutEntry = workoutEntry;
                this.streaks = streaks;
                const todaysItems = checklistItems.filter(i => !i.days || i.days.includes(dow));
                const doneIds = new Set(checklistHistory.filter(h => h.status === 'done').map(h => h.item_id));
                const skippedIds = new Set(checklistHistory.filter(h => h.status === 'skipped').map(h => h.item_id));
                this.checklistTotalToday = todaysItems.length;
                this.checklistDoneToday = todaysItems.filter(i => doneIds.has(i.id)).length;
                this.checklistSkippedToday = todaysItems.filter(i => skippedIds.has(i.id)).length;
                
                // We will move loadTrend out of blocking flow so the main dashboard renders faster
                this.loadTrend().catch(console.error);
            } catch (e) {
                this.errorMsg = 'Could not load Today: ' + e.message;
            }
            this.loading = false;
        },
        // "Today" = due today, overdue-and-still-pending, or undated (always relevant).
        // Kept in sync with recentlyCompleted below so the KPI card's fraction and the two
        // panel sections always describe the same set of tasks -- these used to be two
        // unrelated queries (all-time not-done vs. all-time ever-completed), which is why the
        // KPI number and the visible completed list could disagree (2026-07-25 bug).
        get upcomingTasks() {
            const today = todayIsoDate();
            return this.tasks
                .filter(t => t.status !== 'done' && (!t.scheduled_date || t.scheduled_date <= today))
                .slice(0, 20);
        },
        get recentlyCompleted() {
            const today = todayIsoDate();
            return this.tasks
                .filter(t => t.status === 'done' && t.completed_at && t.completed_at.slice(0, 10) === today)
                .sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1))
                .slice(0, 6);
        },
        get tasksTodayTotal() {
            return this.upcomingTasks.length + this.recentlyCompleted.length;
        },
        get activeProjectCount() {
            return this.projects.length;
        },
        get inProgressProjectCount() {
            return this.projects.filter(p => p.status === 'in_progress').length;
        },
        get checklistPct() {
            // Note: KPI ring percentage explicitly tracks DONE items vs Total, excluding skipped from the 'progress'.
            return this.checklistTotalToday ? Math.round(this.checklistDoneToday / this.checklistTotalToday * 100) : 0;
        },
        get checklistRemaining() {
            // Unmarked / not done / not skipped
            return Math.max(0, this.checklistTotalToday - this.checklistDoneToday - this.checklistSkippedToday);
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

        // ---- add / edit task ----
        openTaskModal() {
            this.editingTaskId = null;
            this.taskForm = { name: '', kind: 'task', date: todayIsoDate(), time: '', projectId: '', notify: false };
            this.taskModalOpen = true;
        },
        openTaskEditModal(task) {
            this.editingTaskId = task.id;
            this.taskForm = {
                name: task.name || '',
                kind: task.kind || 'task',
                date: task.scheduled_date || '',
                time: task.scheduled_time ? task.scheduled_time.slice(0, 5) : '',
                projectId: task.project_id || '',
                notify: !!task.notify_enabled
            };
            this.taskModalOpen = true;
        },
        closeTaskModal() { this.taskModalOpen = false; this.editingTaskId = null; },
        async submitTask() {
            const name = this.taskForm.name.trim();
            if (!name) return;
            const patch = {
                name,
                kind: this.taskForm.kind,
                project_id: this.taskForm.projectId || null,
                scheduled_date: this.taskForm.date || null,
                scheduled_time: this.taskForm.time || null,
                notify_enabled: this.taskForm.notify
            };
            try {
                if (this.editingTaskId) {
                    const row = await DB.Tasks.update(this.editingTaskId, patch);
                    this.tasks = this.tasks.map(t => t.id === row.id ? row : t);
                } else {
                    const row = await DB.Tasks.create({ ...patch, status: 'not_started', priority: 'normal' });
                    this.tasks = [...this.tasks, row];
                }
                this.taskModalOpen = false;
                this.editingTaskId = null;
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
            if (!this.hasSleepData) return 'No sleep logged today';
            const parts = [];
            if (this.sleepEntry.duration_minutes != null) parts.push(minutesToHM(this.sleepEntry.duration_minutes));
            if (this.sleepEntry.sleep_score != null) parts.push(`Score ${this.sleepEntry.sleep_score}`);
            return parts.length ? parts.join(' · ') : 'Logged, no details';
        },
        get hasSleepData() {
            if (!this.sleepEntry) return false;
            const e = this.sleepEntry;
            return e.duration_minutes != null || e.sleep_score != null || e.deep_minutes != null || e.rem_minutes != null || e.resting_hr != null || e.hrv != null || e.note;
        },
        openSleepModal() {
            const e = this.sleepEntry;
            const h = e && e.duration_minutes != null ? Math.floor(e.duration_minutes / 60) : '';
            const m = e && e.duration_minutes != null ? e.duration_minutes % 60 : '';
            this.sleepForm = {
                hours: h === '' ? '' : String(h),
                minutes: m === '' ? '' : String(m),
                score: e && e.sleep_score != null ? String(e.sleep_score) : '',
                deep: e && e.deep_minutes != null ? String(e.deep_minutes) : '',
                rem: e && e.rem_minutes != null ? String(e.rem_minutes) : '',
                restingHr: e && e.resting_hr != null ? String(e.resting_hr) : '',
                hrv: e && e.hrv != null ? String(e.hrv) : '',
                note: (e && e.note) || ''
            };
            this.sleepModalOpen = true;
        },
        closeSleepModal() { this.sleepModalOpen = false; },
        async saveSleep() {
            const h = parseInt(this.sleepForm.hours, 10);
            const m = parseInt(this.sleepForm.minutes, 10);
            const toInt = v => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
            const toNum = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
            const patch = {
                duration_minutes: (!isNaN(h) || !isNaN(m)) ? ((isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)) : null,
                sleep_score: toInt(this.sleepForm.score),
                deep_minutes: toInt(this.sleepForm.deep),
                rem_minutes: toInt(this.sleepForm.rem),
                resting_hr: toInt(this.sleepForm.restingHr),
                hrv: toNum(this.sleepForm.hrv),
                note: this.sleepForm.note.trim() || null
            };
            try {
                // Midnight calendar date, per date-rule split (see load()).
                this.sleepEntry = await DB.Sleep.save(todayIsoDate(), patch);
                this.sleepModalOpen = false;
            } catch (e) {
                this.errorMsg = e.message;
            }
        },

        // ---- workout ----
        get workoutSummary() {
            if (!this.hasWorkoutData) return 'No workout logged today';
            const parts = [];
            if (this.workoutEntry.duration_minutes != null) parts.push(this.workoutEntry.duration_minutes + ' min');
            if (this.workoutEntry.workout_type) parts.push(this.workoutEntry.workout_type);
            if (this.workoutEntry.workout_score != null) parts.push(`Score ${this.workoutEntry.workout_score}`);
            return parts.length ? parts.join(' · ') : 'Logged, no details';
        },
        get hasWorkoutData() {
            if (!this.workoutEntry) return false;
            const e = this.workoutEntry;
            return e.duration_minutes != null || e.workout_type || e.workout_score != null || e.calories != null || e.vo2_max != null || e.note;
        },
        openWorkoutModal() {
            const e = this.workoutEntry;
            this.workoutForm = {
                minutes: e && e.duration_minutes != null ? String(e.duration_minutes) : '',
                type: (e && e.workout_type) || '',
                score: e && e.workout_score != null ? String(e.workout_score) : '',
                calories: e && e.calories != null ? String(e.calories) : '',
                vo2Max: e && e.vo2_max != null ? String(e.vo2_max) : '',
                note: (e && e.note) || ''
            };
            this.workoutModalOpen = true;
        },
        closeWorkoutModal() { this.workoutModalOpen = false; },
        async saveWorkout() {
            const toInt = v => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
            const toNum = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
            const patch = {
                duration_minutes: toInt(this.workoutForm.minutes),
                workout_type: this.workoutForm.type.trim() || null,
                workout_score: toInt(this.workoutForm.score),
                calories: toInt(this.workoutForm.calories),
                vo2_max: toNum(this.workoutForm.vo2Max),
                note: this.workoutForm.note.trim() || null
            };
            try {
                // Midnight calendar date, per date-rule split (see load()).
                this.workoutEntry = await DB.Workout.save(todayIsoDate(), patch);
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
