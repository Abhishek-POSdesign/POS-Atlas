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
        viewMode: 'tasks', // 'tasks' | 'checklist'

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

        // ---- trend (last 30 days, checklist done/skipped/missed) ----
        trendDays: [],

        async init() {
            await this.load();
        },
        async load() {
            this.loading = true;
            this.errorMsg = '';
            try {
                const [tasks, projects, noteEntry, sleepEntry] = await Promise.all([
                    DB.Tasks.listActive(),
                    DB.Projects.listActive(),
                    DB.Notebook.getByDate(this.noteDate),
                    DB.Sleep.getByDate(todayKey())
                ]);
                this.tasks = tasks;
                this.projects = projects;
                this.noteEntry = noteEntry;
                this.noteDraft = noteEntry ? noteEntry.body : '';
                this.sleepEntry = sleepEntry;
                await this.loadTrend();
            } catch (e) {
                this.errorMsg = 'Could not load Today: ' + e.message;
            }
            this.loading = false;
        },
        get upcomingTasks() {
            return this.tasks.filter(t => t.status !== 'done').slice(0, 20);
        },
        get activeProjectCount() {
            return this.projects.length;
        },
        get inProgressProjectCount() {
            return this.projects.filter(p => p.status === 'in_progress').length;
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
