// Atlas Calendar -- the full-page past+future view of everything the AI's
// explain_history Fact Package also reads (same db.js range methods, see
// PLAN.md "Atlas AI -- history & future awareness"). Reads only; no ad-hoc
// Supabase calls, everything goes through DB.*.
//
// Mockup-approved shape (2026-07-29, "Balanced" density, refined round 2):
// month grid on top, inline Day Detail full-width below (never a modal/
// right-side drawer -- Atlas already has a right-side AI panel), category
// filter chips above the grid (grid-only, Day Detail always shows the full
// truth for the selected day), drill-down rows into the real existing
// Task/Project/Notebook surfaces via the `nav` callback (never a duplicate
// task modal -- see features/pendingNav.js). Sleep/Workout/Checklist have no
// existing arbitrary-date editor anywhere in the app (Today's versions are
// hardcoded to todayIsoDate()), so those three get a small inline editor
// scoped to whichever date is selected, right inside the Day Detail section
// -- same DB.Sleep.save/DB.Workout.save/DB.Checklist.setStatus calls Today
// uses, just parameterized by date instead of assuming today.

import { DB } from '../db.js';
import { todayIsoDate } from '../date-utils.js';
import { setPendingTask } from '../features/pendingNav.js';

// Same x-html-into-<svg> injection pattern today.js's sessionIconSvg()
// already uses -- a fixed lookup, never user-supplied, safe to inject.
const ICON_PATHS = {
    sleep: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    workout: '<path d="M6 4v16M18 4v16M4 8h4M4 16h4M16 8h4M16 16h4"/>',
    health: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    chevron: '<polyline points="9 18 15 12 9 6"/>'
};

function fmtDur(mins) {
    if (mins == null) return null;
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
}
function toInt(v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; }
function toNum(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }

export function calendarPage(nav) {
    return {
        loading: false,
        errorMsg: '',

        viewYear: new Date().getFullYear(),
        viewMonth: new Date().getMonth(), // 0-indexed
        selectedDate: null,

        // Grid-only filters -- Day Detail is never filtered, per spec.
        categories: { sleep: true, workout: true, checklist: true, tasks: true, reminders: true, projects: true, journal: true },
        categoryDefs: [
            { key: 'sleep', label: 'Sleep', icon: 'sleep' },
            { key: 'workout', label: 'Workout', icon: 'workout' },
            { key: 'checklist', label: 'Checklist', icon: 'check' },
            { key: 'tasks', label: 'Tasks', icon: 'list' },
            { key: 'reminders', label: 'Reminders', icon: 'bell' },
            { key: 'projects', label: 'Projects', icon: 'note' },
            { key: 'journal', label: 'Journal', icon: 'pencil' }
        ],
        rangePresetDefs: [
            { key: 'thisweek', label: 'This week' },
            { key: 'lastweek', label: 'Last week' },
            { key: 'last10', label: 'Last 10 days' },
            { key: 'next10', label: 'Next 10 days' }
        ],
        // UI hint only for now -- the real range logic already lives in
        // aiContext.js's buildExplainHistory / aiPanel.js's _detectHistoryRange.
        rangePreset: 'last10',

        // Fetched once (not per-month) purely for the project-name chip on
        // Projects & Work Log rows -- DB.ProjectNotes/TaskLogs only carry
        // project_id, not the name.
        _projects: [],

        // Raw rows for the currently-loaded grid window (Mon-start, padded
        // to full weeks). Day Detail derives from these, no extra fetch.
        _sleepRows: [], _workoutRows: [], _sessionRows: [], _checklistRows: [],
        _checklistItems: [], _tasksScheduled: [], _tasksCompleted: [],
        _taskLogRows: [], _projectNoteRows: [], _notebookRows: [],
        _gridStart: null, _gridEnd: null,

        editingSleep: false, sleepForm: {},
        editingWorkout: false, workoutForm: {},
        editingChecklistItemId: null, checklistLogForm: {},

        async init() {
            this.selectedDate = todayIsoDate();
            DB.Projects.listActive().then(p => { this._projects = p; }).catch(console.error);
            await this.loadMonth();
        },

        projectName(id) {
            const p = this._projects.find(pr => pr.id === id);
            return p ? p.name : 'Project';
        },

        async loadMonth() {
            this.loading = true;
            this.errorMsg = '';
            try {
                const first = new Date(this.viewYear, this.viewMonth, 1);
                const last = new Date(this.viewYear, this.viewMonth + 1, 0);
                const gridStart = new Date(first);
                gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7));
                const gridEnd = new Date(last);
                gridEnd.setDate(gridEnd.getDate() + (7 - ((gridEnd.getDay() + 6) % 7) - 1));
                const fmt = d => d.toLocaleDateString('en-CA');
                const startStr = fmt(gridStart), endStr = fmt(gridEnd);

                const [sleep, workout, sessions, checklistHist, checklistItems,
                    tasksScheduled, tasksCompleted, taskLogs, projectNotes, notebook] = await Promise.all([
                    DB.Sleep.listForDateRange(startStr, endStr),
                    DB.Workout.listForDateRange(startStr, endStr),
                    DB.WorkoutSessions.listForDateRange(startStr, endStr),
                    DB.Checklist.listHistoryRange(startStr, endStr),
                    DB.Checklist.listItems(),
                    DB.Tasks.listScheduledInRange(startStr, endStr),
                    DB.Tasks.listCompletedInRange(startStr, endStr),
                    DB.TaskLogs.listForDateRange(startStr, endStr),
                    DB.ProjectNotes.listForDateRange(startStr, endStr),
                    DB.Notebook.listForDateRange(startStr, endStr)
                ]);

                this._sleepRows = sleep; this._workoutRows = workout; this._sessionRows = sessions;
                this._checklistRows = checklistHist; this._checklistItems = checklistItems;
                this._tasksScheduled = tasksScheduled; this._tasksCompleted = tasksCompleted;
                this._taskLogRows = taskLogs; this._projectNoteRows = projectNotes; this._notebookRows = notebook;
                this._gridStart = gridStart; this._gridEnd = gridEnd;
            } catch (e) {
                this.errorMsg = 'Could not load Calendar: ' + e.message;
            }
            this.loading = false;
        },

        prevMonth() {
            this.viewMonth--;
            if (this.viewMonth < 0) { this.viewMonth = 11; this.viewYear--; }
            this.loadMonth();
        },
        nextMonth() {
            this.viewMonth++;
            if (this.viewMonth > 11) { this.viewMonth = 0; this.viewYear++; }
            this.loadMonth();
        },
        goToToday() {
            const t = new Date();
            this.viewYear = t.getFullYear();
            this.viewMonth = t.getMonth();
            this.selectedDate = todayIsoDate();
            this.loadMonth();
        },
        setYear(y) {
            this.viewYear = parseInt(y, 10);
            this.loadMonth();
        },
        get monthLabel() {
            return new Date(this.viewYear, this.viewMonth, 1).toLocaleDateString('en-US', { month: 'long' });
        },
        get yearOptions() {
            const cur = new Date().getFullYear();
            const arr = [];
            for (let y = cur - 2; y <= cur + 2; y++) arr.push(y);
            return arr;
        },

        iconSvg(name) { return ICON_PATHS[name] || ''; },

        toggleCategory(cat) { this.categories[cat] = !this.categories[cat]; },
        setRangePreset(r) { this.rangePreset = r; },

        selectDate(dateStr) {
            this.selectedDate = dateStr;
            this.editingSleep = false;
            this.editingWorkout = false;
            this.editingChecklistItemId = null;
        },

        // Tasks/reminders touching a date: scheduled there (not yet done) OR
        // completed there, deduped by id -- a task scheduled 3 days ago but
        // finished today shows on today, not its original date.
        _dayItems(dateStr) {
            const scheduled = this._tasksScheduled.filter(t => t.scheduled_date === dateStr);
            const completed = this._tasksCompleted.filter(t => t.completed_at && t.completed_at.slice(0, 10) === dateStr);
            const byId = {};
            scheduled.concat(completed).forEach(t => { byId[t.id] = t; });
            return Object.values(byId);
        },

        // Flat cell list (not nested by week) -- the grid CSS's
        // repeat(7, 1fr) column template wraps rows on its own, so the
        // template only needs one x-for over one grid container.
        get days() {
            if (!this._gridStart) return [];
            const days = [];
            const todayStr = todayIsoDate();
            let d = new Date(this._gridStart);
            while (d <= this._gridEnd) {
                const dateStr = d.toLocaleDateString('en-CA');
                days.push({
                    date: dateStr,
                    day: d.getDate(),
                    inMonth: d.getMonth() === this.viewMonth,
                    isToday: dateStr === todayStr,
                    isSelected: dateStr === this.selectedDate,
                    lines: this._cellLines(dateStr).slice(0, 4),
                    moreCount: Math.max(0, this._cellLines(dateStr).length - 4)
                });
                d.setDate(d.getDate() + 1);
            }
            return days;
        },

        _cellLines(dateStr) {
            const today = todayIsoDate();
            const lines = [];
            const sleep = this._sleepRows.find(s => s.entry_date === dateStr);
            const workout = this._workoutRows.find(w => w.entry_date === dateStr);
            const checklist = this._checklistRows.filter(h => h.entry_date === dateStr);
            const items = this._dayItems(dateStr);
            const taskItems = items.filter(t => t.kind !== 'reminder');
            const remItems = items.filter(t => t.kind === 'reminder');
            const overdueTasks = taskItems.filter(t => t.status !== 'done' && dateStr < today).length;
            const overdueRem = remItems.filter(t => t.status !== 'done' && dateStr < today).length;
            const projCount = this._taskLogRows.filter(l => l.entry_date === dateStr).length +
                this._projectNoteRows.filter(n => (n.created_at || '').slice(0, 10) === dateStr).length;
            const journal = this._notebookRows.find(n => n.entry_date === dateStr);

            if (this.categories.sleep && sleep) lines.push({ cat: 'sleep', icon: 'sleep', text: fmtDur(sleep.duration_minutes) || 'Logged' });
            if (this.categories.workout && workout) {
                const label = workout.day_type === 'active_recovery' ? 'Active recovery'
                    : workout.day_type === 'full_rest' ? 'Full rest'
                        : (workout.workout_type || 'Workout');
                lines.push({ cat: 'workout', icon: 'workout', text: label });
            }
            if (this.categories.checklist && checklist.length) {
                const done = checklist.filter(c => c.status === 'done').length;
                lines.push({ cat: 'checklist', icon: 'check', text: done + '/' + checklist.length });
            }
            if (this.categories.tasks && taskItems.length) {
                lines.push({ cat: 'tasks', icon: 'list', text: taskItems.length + ' task' + (taskItems.length === 1 ? '' : 's') });
                if (overdueTasks) lines.push({ cat: 'tasks', icon: 'list', text: overdueTasks + ' overdue', coral: true });
            }
            if (this.categories.reminders && remItems.length) {
                lines.push({ cat: 'reminders', icon: 'bell', text: remItems.length + ' reminder' + (remItems.length === 1 ? '' : 's') });
                if (overdueRem) lines.push({ cat: 'reminders', icon: 'bell', text: overdueRem + ' overdue', coral: true });
            }
            if (this.categories.projects && projCount) lines.push({ cat: 'projects', icon: 'note', text: projCount + ' log' + (projCount === 1 ? '' : 's') });
            if (this.categories.journal && journal) lines.push({ cat: 'journal', icon: 'pencil', text: 'Journal' });
            return lines;
        },

        // ---- Day Detail: derived from the already-loaded grid window, no
        // extra fetch (selection only ever happens within the visible month). ----
        get selectedSleep() { return this._sleepRows.find(s => s.entry_date === this.selectedDate) || null; },
        get selectedWorkout() { return this._workoutRows.find(w => w.entry_date === this.selectedDate) || null; },
        get selectedWorkoutSessions() {
            return this._sessionRows.filter(s => s.atlas_workout_logs && s.atlas_workout_logs.entry_date === this.selectedDate);
        },
        // Only checklist items applicable to this date's weekday, joined
        // with that date's history row if one exists -- same join
        // buildExplainDay() already does for "today," generalized to any date.
        get selectedChecklist() {
            if (!this.selectedDate) return [];
            const dow = new Date(this.selectedDate + 'T00:00:00').getDay();
            const applicable = this._checklistItems.filter(i => !i.days || i.days.includes(dow));
            const rowsByItem = {};
            this._checklistRows.filter(h => h.entry_date === this.selectedDate).forEach(h => { rowsByItem[h.item_id] = h; });
            return applicable.map(item => ({ item, history: rowsByItem[item.id] || null }));
        },
        get selectedChecklistMarked() { return this.selectedChecklist.filter(c => c.history); },
        get selectedTasks() {
            return this._dayItems(this.selectedDate).sort((a, b) => {
                const at = a.scheduled_time || '', bt = b.scheduled_time || '';
                return at < bt ? -1 : (at > bt ? 1 : 0);
            });
        },
        get selectedProjectWork() {
            const logs = this._taskLogRows
                .filter(l => l.entry_date === this.selectedDate)
                .map(l => ({ kind: 'log', body: l.body, project_id: l.project_id, id: 'log-' + l.id }));
            const notes = this._projectNoteRows
                .filter(n => (n.created_at || '').slice(0, 10) === this.selectedDate && n.project_id)
                .map(n => ({ kind: 'note', body: n.body, project_id: n.project_id, id: 'note-' + n.id }));
            return logs.concat(notes);
        },
        get selectedJournal() { return this._notebookRows.find(n => n.entry_date === this.selectedDate) || null; },
        get selectedDateLabel() {
            if (!this.selectedDate) return '';
            return new Date(this.selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        },
        get selectedIsFuture() { return this.selectedDate > todayIsoDate(); },
        get selectedIsToday() { return this.selectedDate === todayIsoDate(); },
        get selectedHasAnything() {
            return !!(this.selectedSleep || this.selectedWorkout || this.selectedChecklist.length ||
                this.selectedTasks.length || this.selectedProjectWork.length || this.selectedJournal);
        },
        get selectedMissedCount() { return this.selectedChecklist.filter(c => !c.history).length; },

        taskStatus(t) {
            if (t.status === 'done') return 'done';
            if (t.scheduled_date && t.scheduled_date < todayIsoDate()) return 'overdue';
            return 'upcoming';
        },

        // ---- drill-downs: reuse existing surfaces, never a duplicate page ----
        openTaskDrillDown(task) {
            setPendingTask(task);
            if (task.project_id) nav.onOpenProject(task.project_id);
            else nav.onGoToday();
        },
        openProjectWorkDrillDown(entry) {
            if (entry.project_id) nav.onOpenProject(entry.project_id);
        },
        openJournalDrillDown() { nav.onOpenNotebook(); },

        // ---- inline Sleep editor (Today's modal is hardcoded to
        // todayIsoDate() and has no arbitrary-date mode -- this is the same
        // field set and the same DB.Sleep.save() call, just parameterized by
        // whichever date is selected here). ----
        openSleepEditor() {
            const e = this.selectedSleep;
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
                note: (e && e.note) || '',
                morningNote: (e && e.morning_note) || ''
            };
            this.editingSleep = true;
        },
        closeSleepEditor() { this.editingSleep = false; },
        async saveSleepEditor() {
            const h = parseInt(this.sleepForm.hours, 10), m = parseInt(this.sleepForm.minutes, 10);
            const patch = {
                duration_minutes: (!isNaN(h) || !isNaN(m)) ? ((isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)) : null,
                sleep_score: toInt(this.sleepForm.score),
                deep_minutes: toInt(this.sleepForm.deep),
                rem_minutes: toInt(this.sleepForm.rem),
                resting_hr: toInt(this.sleepForm.restingHr),
                hrv: toNum(this.sleepForm.hrv),
                note: this.sleepForm.note.trim() || null,
                morning_note: this.sleepForm.morningNote.trim() || null
            };
            try {
                const row = await DB.Sleep.save(this.selectedDate, patch);
                this._sleepRows = this._sleepRows.filter(s => s.entry_date !== this.selectedDate).concat([row]);
                this.editingSleep = false;
            } catch (e) {
                this.errorMsg = 'Save failed: ' + e.message;
            }
        },

        // ---- inline Workout editor (day-level log fields only -- full
        // per-session add/edit/delete stays on Today for now, this covers
        // the day_type + summary fields for reviewing/correcting a past day). ----
        openWorkoutEditor() {
            const e = this.selectedWorkout;
            this.workoutForm = {
                dayType: (e && e.day_type) || 'workout',
                duration: e && e.duration_minutes != null ? String(e.duration_minutes) : '',
                workoutType: (e && e.workout_type) || '',
                score: e && e.workout_score != null ? String(e.workout_score) : '',
                calories: e && e.calories != null ? String(e.calories) : '',
                vo2max: e && e.vo2_max != null ? String(e.vo2_max) : '',
                note: (e && e.note) || ''
            };
            this.editingWorkout = true;
        },
        closeWorkoutEditor() { this.editingWorkout = false; },
        async saveWorkoutEditor() {
            const patch = {
                day_type: this.workoutForm.dayType,
                duration_minutes: toInt(this.workoutForm.duration),
                workout_type: this.workoutForm.workoutType.trim() || null,
                workout_score: toInt(this.workoutForm.score),
                calories: toInt(this.workoutForm.calories),
                vo2_max: toNum(this.workoutForm.vo2max),
                note: this.workoutForm.note.trim() || null
            };
            try {
                const row = await DB.Workout.save(this.selectedDate, patch);
                this._workoutRows = this._workoutRows.filter(w => w.entry_date !== this.selectedDate).concat([row]);
                this.editingWorkout = false;
            } catch (e) {
                this.errorMsg = 'Save failed: ' + e.message;
            }
        },

        // ---- inline Checklist item editor (same DB.Checklist.setStatus()
        // upsert Today's Log popup uses, parameterized by selectedDate). ----
        openChecklistEditor(itemId) {
            const existing = this._checklistRows.find(h => h.entry_date === this.selectedDate && h.item_id === itemId);
            this.checklistLogForm = {
                time: (existing && existing.logged_time) || '',
                note: (existing && existing.note) || ''
            };
            this.editingChecklistItemId = itemId;
        },
        closeChecklistEditor() { this.editingChecklistItemId = null; },
        // status is 'done' | 'skipped' | 'holiday' -- the same 3 real values
        // checklist.js's own Log popup writes; 'missed' is never a settable
        // status, only the derived absence of any history row for the day.
        async saveChecklistEditor(status) {
            try {
                const extra = { note: this.checklistLogForm.note.trim() };
                if (status === 'done' || status === 'holiday') extra.loggedTime = this.checklistLogForm.time;
                const row = await DB.Checklist.setStatus(this.editingChecklistItemId, this.selectedDate, status, extra);
                this._checklistRows = this._checklistRows
                    .filter(h => !(h.entry_date === this.selectedDate && h.item_id === this.editingChecklistItemId))
                    .concat([row]);
                this.editingChecklistItemId = null;
            } catch (e) {
                this.errorMsg = 'Save failed: ' + e.message;
            }
        },
        async undoChecklistEditor() {
            const existing = this._checklistRows.find(h => h.entry_date === this.selectedDate && h.item_id === this.editingChecklistItemId);
            if (!existing) { this.editingChecklistItemId = null; return; }
            try {
                await DB.Checklist.undoStatus(existing.id);
                this._checklistRows = this._checklistRows.filter(h => h.id !== existing.id);
                this.editingChecklistItemId = null;
            } catch (e) {
                this.errorMsg = 'Undo failed: ' + e.message;
            }
        }
    };
}
