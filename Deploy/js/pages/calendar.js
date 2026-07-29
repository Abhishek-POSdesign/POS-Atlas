// Atlas Calendar -- the full-page past+future view of everything the AI's
// explain_history Fact Package also reads (same db.js range methods, see
// PLAN.md "Atlas AI -- history & future awareness"). Read-only; no ad-hoc
// Supabase calls, everything goes through DB.* read methods only.
//
// Mockup-approved shape (2026-07-29, "Balanced" density, refined round 2):
// month grid on top, inline Day Detail full-width below (never a modal/
// right-side drawer -- Atlas already has a right-side AI panel), category
// filter chips above the grid (grid-only, Day Detail always shows the full
// truth for the selected day), drill-down rows into the real existing
// Task/Project/Notebook surfaces via the `nav` callback (never a duplicate
// task modal -- see features/pendingNav.js).
//
// Read-only pass (2026-07-29, live-testing feedback round 2): Sleep, Workout,
// and Checklist inline editors were removed entirely -- Calendar shows what
// happened, it is never where you change it. Checklist stays read-only with
// no drill-down at all (checklist.js is hardcoded to todayKey(), same gap
// Sleep/Workout had -- a real dated Checklist view is a deliberate follow-up,
// not built here). Task/Project/Journal drill-downs now confirm before
// leaving the page. Future dates collapse Tasks & Reminders into grouped
// counts with a "Go to X" link per group instead of per-item interactive
// rows -- a glimpse, not a workspace.

import { DB } from '../db.js';
import { todayIsoDate } from '../date-utils.js';
import { setPendingTask } from '../features/pendingNav.js';
import { askConfirm } from '../components/confirm-dialog.js';

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
    chevron: '<polyline points="9 18 15 12 9 6"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>'
};

function fmtDur(mins) {
    if (mins == null) return null;
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
}

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
        // Filter dropdown (2026-07-29, live-testing bug -- the always-open
        // 7-chip row read as cluttered and pushed the range row into a
        // second visual band). Closed by default, all categories on.
        filterMenuOpen: false,
        get activeCategoryCount() {
            return this.categoryDefs.filter(c => this.categories[c.key]).length;
        },

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

                console.log(`[Atlas Calendar] loaded ${startStr}..${endStr} · sleep=${sleep.length} workout=${workout.length} sessions=${sessions.length} checklistHist=${checklistHist.length} tasksScheduled=${tasksScheduled.length} tasksCompleted=${tasksCompleted.length} taskLogs=${taskLogs.length} projectNotes=${projectNotes.length} notebook=${notebook.length}`);
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
                const cb = this._cellBlocks(dateStr);
                days.push({
                    date: dateStr,
                    day: d.getDate(),
                    inMonth: d.getMonth() === this.viewMonth,
                    isToday: dateStr === todayStr,
                    isSelected: dateStr === this.selectedDate,
                    blocks: cb.blocks,
                    journal: cb.journal
                });
                d.setDate(d.getDate() + 1);
            }
            return days;
        },

        // Vivid pass (2026-07-29, approved on Option A's structure): each day
        // collapses to at most 3 colored blocks -- sage (Health & Checklist),
        // blue (Tasks & Reminders), lilac (Projects & Work Logs) -- matching
        // the 5 locked accent meanings exactly (health/checklist completion
        // reads as "done"-family sage; tasks/planning is blue; projects is
        // lilac). A category never gets its own block beyond these three --
        // Journal has no locked-accent home, so it renders as a small plain
        // (uncolored) line instead of a 4th block, same treatment overdue
        // gets as a coral flag rather than a whole block of its own.
        _cellBlocks(dateStr) {
            const today = todayIsoDate();
            const blocks = [];
            const sleep = this._sleepRows.find(s => s.entry_date === dateStr);
            const workout = this._workoutRows.find(w => w.entry_date === dateStr);
            const checklist = this._checklistRows.filter(h => h.entry_date === dateStr);
            const items = this._dayItems(dateStr);
            const taskItems = items.filter(t => t.kind !== 'reminder');
            const remItems = items.filter(t => t.kind === 'reminder');
            const overdueCount = items.filter(t => t.status !== 'done' && dateStr < today).length;
            const projCount = this._taskLogRows.filter(l => l.entry_date === dateStr).length +
                this._projectNoteRows.filter(n => (n.created_at || '').slice(0, 10) === dateStr).length;
            const journal = this._notebookRows.find(n => n.entry_date === dateStr);

            const showSleep = this.categories.sleep && sleep;
            const showWorkout = this.categories.workout && workout;
            const showChecklist = this.categories.checklist && checklist.length;
            if (showSleep || showWorkout || showChecklist) {
                const parts = [];
                if (showSleep) parts.push('Sleep ' + (fmtDur(sleep.duration_minutes) || 'logged'));
                if (showWorkout) {
                    const label = workout.day_type === 'active_recovery' ? 'Active recovery'
                        : workout.day_type === 'full_rest' ? 'Full rest'
                            : (workout.workout_type || 'Workout');
                    parts.push(label);
                }
                if (showChecklist) {
                    const done = checklist.filter(c => c.status === 'done').length;
                    parts.push(done + '/' + checklist.length);
                }
                blocks.push({
                    color: 'sage', icon: showSleep ? 'sleep' : 'workout',
                    t1: parts[0], t2: parts.slice(1).join(' · ') || null
                });
            }

            const showTasks = this.categories.tasks && taskItems.length;
            const showReminders = this.categories.reminders && remItems.length;
            if (showTasks || showReminders) {
                const parts = [];
                if (showTasks) parts.push(taskItems.length + ' task' + (taskItems.length === 1 ? '' : 's'));
                if (showReminders) parts.push(remItems.length + ' reminder' + (remItems.length === 1 ? '' : 's'));
                blocks.push({
                    color: 'blue', icon: showReminders && !showTasks ? 'bell' : 'list',
                    t1: parts.join(' · '), t2: null,
                    overdueFlag: overdueCount || null
                });
            }

            if (this.categories.projects && projCount) {
                blocks.push({ color: 'lilac', icon: 'note', t1: projCount + ' log' + (projCount === 1 ? '' : 's'), t2: null });
            }

            return { blocks, journal: !!(this.categories.journal && journal) };
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
        // Future-date summary -- grouped by project (or "no project"), counts
        // only. Used instead of selectedTasks' per-item rows so a future day
        // reads as a glimpse ("3 tasks, 1 reminder") rather than a workspace.
        get selectedTaskGroups() {
            const groups = {};
            for (const t of this.selectedTasks) {
                const key = t.project_id || '__none__';
                if (!groups[key]) groups[key] = { project_id: t.project_id || null, tasks: 0, reminders: 0 };
                if (t.kind === 'reminder') groups[key].reminders++; else groups[key].tasks++;
            }
            return Object.values(groups);
        },
        taskGroupLabel(g) {
            const parts = [];
            if (g.tasks) parts.push(g.tasks + ' task' + (g.tasks === 1 ? '' : 's'));
            if (g.reminders) parts.push(g.reminders + ' reminder' + (g.reminders === 1 ? '' : 's'));
            return parts.join(' · ');
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

        // ---- drill-downs: reuse existing surfaces, never a duplicate page.
        // Each confirms first (askConfirm) since leaving the Calendar loses
        // the browsed date -- confirmed live 2026-07-29 this was jarring
        // without warning. ----
        async openTaskDrillDown(task) {
            const ok = await askConfirm('Open this task? You\'ll leave the Calendar view.', { confirmLabel: 'Open', isDanger: false });
            if (!ok) return;
            setPendingTask(task);
            if (task.project_id) nav.onOpenProject(task.project_id);
            else nav.onGoToday();
        },
        async goToTaskGroup(g) {
            const ok = await askConfirm('Open this in Tasks? You\'ll leave the Calendar view.', { confirmLabel: 'Open', isDanger: false });
            if (!ok) return;
            if (g.project_id) nav.onOpenProject(g.project_id);
            else nav.onGoToday();
        },
        async openProjectWorkDrillDown(entry) {
            if (!entry.project_id) return;
            const ok = await askConfirm('Open this project? You\'ll leave the Calendar view.', { confirmLabel: 'Open', isDanger: false });
            if (!ok) return;
            nav.onOpenProject(entry.project_id);
        },
        async openJournalDrillDown() {
            const ok = await askConfirm('Open your journal? You\'ll leave the Calendar view.', { confirmLabel: 'Open', isDanger: false });
            if (!ok) return;
            nav.onOpenNotebook();
        }
    };
}
