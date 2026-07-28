import { DB } from '../db.js';
import { getLogicalDate, todayKey, todayIsoDate } from '../date-utils.js';
import { showUndoToast } from '../components/undo-toast.js';
import { askConfirm } from '../components/confirm-dialog.js';
import { consumePendingTask } from '../features/pendingNav.js';

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
        sleepStep: 1,
        sleepForm: { hours: '', minutes: '', score: '', deep: '', rem: '', restingHr: '', hrv: '', note: '', morningNote: '' },

        // ---- workout ----
        workoutEntry: null,
        workoutModalOpen: false,
        workoutSessions: [],
        showSessionForm: false,
        workoutSessionsLoading: false,
        workoutSessionForm: { type: 'strength', duration: '', intensity: '', programTag: '', note: '' },
        editingSessionId: null,

        // ---- weekly targets ----
        workoutTargets: [],
        targetsEditorOpen: false,
        targetsDraft: {},

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

        // ---- Upcoming modal (Phase 6) ----
        // Today's own list/filter (upcomingTasks below) never widens beyond
        // today+overdue+undated -- this modal is the one place future-dated
        // tasks/reminders are visible and manageable without leaving Today.
        upcomingModalOpen: false,

        // ---- checklist KPI (today's done/total, for the ring) ----
        checklistDoneToday: 0,
        checklistTotalToday: 0,
        checklistSkippedToday: 0,

        // ---- trend (last 30 days, checklist done/skipped/missed) ----
        trendDays: [],

        async init() {
            await this.load();
            // Refresh when AI panel confirms a write (workout, sleep, task, checklist)
            window.addEventListener('atlas:data-changed', () => { this.load().catch(console.error); });
            // Calendar's Tasks & Reminders drill-down hands off a task here
            // (standalone tasks only -- project-linked ones go to the
            // Project workspace instead) so it opens Today's own real task
            // edit modal rather than a duplicate.
            const pending = consumePendingTask();
            if (pending) this.openTaskEditModal(pending);
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
                if (workoutEntry) {
                    this.workoutSessionsLoading = true;
                    this.workoutSessions = await DB.WorkoutSessions.listForLog(workoutEntry.id);
                    this.workoutSessionsLoading = false;
                } else {
                    this.workoutSessions = [];
                }
                this.streaks = streaks;
                const todaysItems = checklistItems.filter(i => !i.days || i.days.includes(dow));
                const doneIds = new Set(checklistHistory.filter(h => h.status === 'done').map(h => h.item_id));
                const skippedIds = new Set(checklistHistory.filter(h => h.status === 'skipped').map(h => h.item_id));
                this.checklistTotalToday = todaysItems.length;
                this.checklistDoneToday = todaysItems.filter(i => doneIds.has(i.id)).length;
                this.checklistSkippedToday = todaysItems.filter(i => skippedIds.has(i.id)).length;
                
                this.loadTrend().catch(console.error);
                this.loadWorkoutTargets().catch(console.error);
                this.loadHealthTrend().catch(console.error);
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
        // ---- future-dated tasks/reminders (Phase 6, Upcoming modal) ----
        // A clean partition of upcomingTasks above: that one only ever
        // includes scheduled_date <= today or undated, this one is strictly
        // scheduled_date > today. No overlap, upcomingTasks itself unchanged.
        get futureTasks() {
            const today = todayIsoDate();
            return this.tasks
                .filter(t => t.status !== 'done' && t.scheduled_date && t.scheduled_date > today)
                .sort((a, b) => {
                    if (a.scheduled_date !== b.scheduled_date) return a.scheduled_date < b.scheduled_date ? -1 : 1;
                    const at = a.scheduled_time || '';
                    const bt = b.scheduled_time || '';
                    return at < bt ? -1 : (at > bt ? 1 : 0);
                })
                .slice(0, 50);
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

        // ---- Upcoming modal (Phase 6) ----
        // Stays open behind the task edit modal (2026-07-28) -- clicking a
        // row calls the ordinary openTaskEditModal(task) directly, no
        // special wrapper needed. Its overlay has a higher z-index (150,
        // see index.html) so it visually stacks on top; cancel/save/delete
        // on the edit modal only ever touches taskModalOpen, so closing it
        // naturally reveals this modal again, still open, list already
        // reactive to whatever changed.
        openUpcomingModal() { this.upcomingModalOpen = true; },
        closeUpcomingModal() { this.upcomingModalOpen = false; },
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

        // ---- Two-step done confirmation ----
        // First click on the round checkbox arms the row (pendingCompleteId
        // holds its id, checkbox goes to a half-committed sage-tinted state,
        // an inline "Tap again to confirm" hint appears in the row's meta
        // line). Second click within 2.5s commits. A click on any other row's
        // checkbox, or the timer expiring silently, resets. Prevents an
        // accidental tap from marking something done -- explicitly requested
        // after live testing. Delete already has askConfirm() + undo toast.
        pendingCompleteId: null,
        _pendingCompleteTimer: null,
        isPendingComplete(task) { return this.pendingCompleteId === task.id; },
        handleCompleteClick(task) {
            if (this.pendingCompleteId === task.id) {
                this._clearPendingComplete();
                this.completeTaskOnToday(task);
            } else {
                this._clearPendingComplete();
                this.pendingCompleteId = task.id;
                this._pendingCompleteTimer = setTimeout(() => this._clearPendingComplete(), 2500);
            }
        },
        _clearPendingComplete() {
            if (this._pendingCompleteTimer) {
                clearTimeout(this._pendingCompleteTimer);
                this._pendingCompleteTimer = null;
            }
            this.pendingCompleteId = null;
        },

        // Inline done/delete for the Today Tasks & Reminders card. These are
        // deliberately quick actions (no completion-note prompt) -- the full
        // Project workspace path still auto-logs a "Completed: {name}" entry
        // in its own Work log. Both work identically for kind='task' and
        // kind='reminder' -- a "done" reminder is just a task-shape row with
        // status='done'.
        async completeTaskOnToday(task) {
            try {
                const updated = await DB.Tasks.complete(task.id, null);
                this.tasks = this.tasks.map(t => t.id === updated.id ? updated : t);
            } catch (e) {
                this.errorMsg = e.message;
            }
        },
        async deleteTaskOnToday(task) {
            const label = task.kind === 'reminder' ? 'reminder' : 'task';
            const ok = await askConfirm(`Delete ${label} "${task.name}"? You can restore it from the Restore view afterward.`);
            if (!ok) return;
            const snapshot = this.tasks;
            this.tasks = this.tasks.filter(t => t.id !== task.id);
            try {
                await DB.Tasks.softDelete(task.id);
                showUndoToast(`Deleted ${label} "${task.name}"`, async () => {
                    const restored = await DB.Tasks.restoreFromTrash(task.id);
                    this.tasks = [...this.tasks.filter(t => t.id !== restored.id), restored];
                });
            } catch (e) {
                this.tasks = snapshot;
                this.errorMsg = 'Delete failed: ' + e.message;
            }
        },
        // Called from the Delete button inside the task edit modal (Round 2
        // build, item 13). Reuses deleteTaskOnToday for the actual delete +
        // undo-toast flow -- just also closes the modal on success. The
        // askConfirm() inside deleteTaskOnToday IS the second deliberate
        // action; combined with the undo toast, this is still two-step +
        // safety net, same guarantee as the old row-level delete.
        async deleteFromEditModal() {
            if (!this.editingTaskId) return;
            const task = this.tasks.find(t => t.id === this.editingTaskId);
            if (!task) { this.closeTaskModal(); return; }
            const before = this.tasks;
            await this.deleteTaskOnToday(task);
            // Close modal only if the delete actually removed the row (i.e.
            // user confirmed and it succeeded -- state was optimistically
            // trimmed, not restored to `before`).
            if (this.tasks !== before) this.closeTaskModal();
        },
        async pauseTask() {
            if (!this.editingTaskId) return;
            const reason = await askNote('Why are you pausing?', {
                submitLabel: 'Pause', skipLabel: 'Just pause'
            });
            if (reason === false) return;
            try {
                const updated = await DB.Tasks.update(this.editingTaskId, { status: 'paused', running_note: reason || null });
                this.tasks = this.tasks.map(t => t.id === updated.id ? updated : t);
                this.closeTaskModal();
            } catch (e) {
                this.errorMsg = 'Pause failed: ' + e.message;
            }
        },

        // Overdue = due in the past AND not yet done. Deliberately narrow
        // definition so no future session guesses at edges:
        //   - status === 'done'                            -> never overdue
        //   - scheduled_date < today                        -> overdue (any time)
        //   - scheduled_date == today && time set && time < now -> overdue
        //   - undated or future-dated                       -> not overdue
        // Applies to both tasks and reminders.
        isOverdue(task) {
            if (!task || task.status === 'done') return false;
            if (!task.scheduled_date) return false;
            const today = todayIsoDate();
            if (task.scheduled_date < today) return true;
            if (task.scheduled_date === today && task.scheduled_time) {
                const now = new Date();
                const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
                const scheduled = task.scheduled_time.slice(0, 5);
                return scheduled < hhmm;
            }
            return false;
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
            return e.duration_minutes != null || e.sleep_score != null || e.deep_minutes != null || e.rem_minutes != null || e.resting_hr != null || e.hrv != null || e.note || e.morning_note;
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
                note: (e && e.note) || '',
                morningNote: (e && e.morning_note) || ''
            };
            this.sleepStep = 1;
            this.sleepModalOpen = true;
        },
        closeSleepModal() { this.sleepModalOpen = false; },
        _buildSleepPatch() {
            const h = parseInt(this.sleepForm.hours, 10);
            const m = parseInt(this.sleepForm.minutes, 10);
            const toInt = v => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
            const toNum = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
            return {
                duration_minutes: (!isNaN(h) || !isNaN(m)) ? ((isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)) : null,
                sleep_score: toInt(this.sleepForm.score),
                deep_minutes: toInt(this.sleepForm.deep),
                rem_minutes: toInt(this.sleepForm.rem),
                resting_hr: toInt(this.sleepForm.restingHr),
                hrv: toNum(this.sleepForm.hrv),
                note: this.sleepForm.note.trim() || null,
                morning_note: this.sleepForm.morningNote.trim() || null
            };
        },
        async saveSleep() {
            try {
                this.sleepEntry = await DB.Sleep.save(todayIsoDate(), this._buildSleepPatch());
                this.sleepModalOpen = false;
            } catch (e) {
                this.errorMsg = e.message;
            }
        },
        async saveSleepStep1() {
            // Save metrics from step 1 only (morning_note stays null/unchanged)
            try {
                this.sleepEntry = await DB.Sleep.save(todayIsoDate(), this._buildSleepPatch());
                this.sleepModalOpen = false;
            } catch (e) {
                this.errorMsg = e.message;
            }
        },
        async advanceSleepToStep2() {
            // Save step 1 silently, then advance to step 2 for the morning reflection
            try {
                this.sleepEntry = await DB.Sleep.save(todayIsoDate(), this._buildSleepPatch());
                this.sleepStep = 2;
            } catch (e) {
                this.errorMsg = e.message;
            }
        },

        // ---- weekly targets ----
        getWeekRange() {
            // Returns { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } for Mon–Sun of current week
            const today = new Date();
            const dow = today.getDay(); // 0=Sun, 1=Mon...
            const diffToMon = (dow === 0) ? -6 : 1 - dow;
            const mon = new Date(today);
            mon.setDate(today.getDate() + diffToMon);
            const sun = new Date(mon);
            sun.setDate(mon.getDate() + 6);
            const fmt = d => d.toLocaleDateString('en-CA');
            return { start: fmt(mon), end: fmt(sun) };
        },
        async loadWorkoutTargets() {
            let targets = await DB.WorkoutTargets.list();
            // Seed defaults if table is empty
            if (!targets || targets.length === 0) {
                const defaults = [
                    { activity_type: 'strength', target_days_per_week: 4 },
                    { activity_type: 'active_play', target_days_per_week: 7 },
                    { activity_type: 'yoga_stretch', target_days_per_week: 2 },
                    { activity_type: 'cleaning', target_days_per_week: 1 }
                ];
                targets = await Promise.all(
                    defaults.map(d => DB.WorkoutTargets.upsert(d.activity_type, { target_days_per_week: d.target_days_per_week }))
                );
            }
            this.workoutTargets = targets;
            // Also load this week's sessions for the dot grid
            const { start, end } = this.getWeekRange();
            try {
                this._weekSessions = await DB.WorkoutSessions.listForDateRange(start, end);
            } catch (e) {
                this._weekSessions = [];
            }
        },
        get weeklyProgress() {
            const sessions = this._weekSessions || [];
            return this.workoutTargets.map(t => {
                const actual = sessions.filter(s => s.activity_type === t.activity_type).length;
                const target = t.target_days_per_week;
                const dots = [];
                for (let i = 0; i < target; i++) {
                    dots.push(i < actual ? 'met' : 'pending');
                }
                return { type: t.activity_type, actual, target, dots };
            });
        },
        openTargetsEditor() {
            const draft = {};
            this.workoutTargets.forEach(t => { draft[t.activity_type] = String(t.target_days_per_week); });
            this.targetsDraft = draft;
            this.targetsEditorOpen = true;
        },
        closeTargetsEditor() { this.targetsEditorOpen = false; },
        async saveTargetsDraft() {
            try {
                const results = await Promise.all(
                    Object.entries(this.targetsDraft).map(([type, val]) => {
                        const days = parseInt(val, 10);
                        if (isNaN(days) || days < 0 || days > 7) return null;
                        return DB.WorkoutTargets.upsert(type, { target_days_per_week: days });
                    }).filter(Boolean)
                );
                this.workoutTargets = await DB.WorkoutTargets.list();
                this.targetsEditorOpen = false;
            } catch (e) {
                this.errorMsg = e.message;
            }
        },

        // ---- workout day-type toggle (Round 2 build, item 5) ----
        // Read from the loaded entry; unset if there's no entry OR the entry
        // has no day_type (older rows from before migration 013).
        get workoutDayType() {
            return (this.workoutEntry && this.workoutEntry.day_type) || null;
        },
        async setWorkoutDayType(type) {
            if (!['workout', 'active_recovery', 'full_rest'].includes(type)) return;
            try {
                // When there's no loaded entry (post-deletion or first of the
                // day), pass explicit nulls for all data fields so the upsert
                // doesn't resurrect stale data from a soft-deleted row that
                // still physically exists on the same entry_date.
                const patch = !this.workoutEntry
                    ? { day_type: type, workout_score: null, calories: null, duration_minutes: null, workout_type: null, vo2_max: null, note: null }
                    : { day_type: type };
                this.workoutEntry = await DB.Workout.save(todayIsoDate(), patch);
            } catch (e) {
                this.errorMsg = 'Save failed: ' + e.message;
            }
        },

        // ---- workout ----
        get workoutSummary() {
            if (this.workoutSessions && this.workoutSessions.length > 0) {
                const totalMins = this.workoutSessions.reduce((acc, s) => acc + (s.duration_minutes || 0), 0);
                const types = [...new Set(this.workoutSessions.map(s => s.activity_type))];
                return `${totalMins} min · ${types.join(', ')}`;
            }
            if (!this.hasWorkoutData) return 'No workout logged today';
            const parts = [];
            if (this.workoutEntry.duration_minutes != null) parts.push(this.workoutEntry.duration_minutes + ' min');
            if (this.workoutEntry.workout_type) parts.push(this.workoutEntry.workout_type);
            if (this.workoutEntry.workout_score != null) parts.push(`Score ${this.workoutEntry.workout_score}`);
            return parts.length ? parts.join(' · ') : 'Logged, no details';
        },
        get hasWorkoutData() {
            if (!this.workoutEntry) return false;
            if (this.workoutSessions && this.workoutSessions.length > 0) return true;
            const e = this.workoutEntry;
            return e.duration_minutes != null || e.workout_type || e.workout_score != null || e.calories != null || e.vo2_max != null || e.note;
        },
        async openWorkoutModal() {
            this.showSessionForm = false;
            this.editingSessionId = null;
            this.workoutSessionForm = { type: 'strength', duration: '', intensity: '', programTag: '', note: '' };
            if (this.workoutEntry) {
                try {
                    this.workoutSessions = await DB.WorkoutSessions.listForLog(this.workoutEntry.id);
                } catch (e) {
                    this.errorMsg = e.message;
                }
            }
            if (this.workoutSessions.length === 0) {
                this.showSessionForm = true;
            }
            this.workoutModalOpen = true;
        },
        closeWorkoutModal() { this.workoutModalOpen = false; },
        
        openWorkoutSessionForm(session = null) {
            if (session) {
                this.editingSessionId = session.id;
                this.workoutSessionForm = {
                    type: session.activity_type || 'strength',
                    duration: session.duration_minutes ? String(session.duration_minutes) : '',
                    intensity: session.intensity || '',
                    programTag: session.program_tag || '',
                    note: session.note || ''
                };
            } else {
                this.editingSessionId = null;
                this.workoutSessionForm = { type: 'strength', duration: '', intensity: '', programTag: '', note: '' };
            }
            this.showSessionForm = true;
            this.workoutModalOpen = true;
        },
        closeWorkoutSessionForm() {
            this.showSessionForm = false;
            this.editingSessionId = null;
        },
        // Muted per-activity-type icon for each session pill (Comet review
        // follow-up) -- same visual language as the sleep chip icons, not
        // colored per type (activity colour-coding was already rejected
        // elsewhere in Atlas). `type` only ever comes from the fixed
        // <select> in the session form, never free text, so returning raw
        // SVG markup for x-html here is safe.
        sessionIconSvg(type) {
            const icons = {
                strength: '<path d="M6 4v16M18 4v16M4 8h4M4 16h4M16 8h4M16 16h4"/>',
                cardio_walk: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
                yoga_stretch: '<path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>',
                active_play: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
                cleaning: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'
            };
            return icons[type] || icons.strength;
        },
        async saveWorkoutSession() {
            if (!this.workoutEntry) return;
            const toInt = v => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
            const patch = {
                activity_type: this.workoutSessionForm.type,
                duration_minutes: toInt(this.workoutSessionForm.duration),
                intensity: this.workoutSessionForm.type === 'strength' ? (this.workoutSessionForm.intensity || null) : null,
                program_tag: this.workoutSessionForm.type === 'strength' ? (this.workoutSessionForm.programTag || null) : null,
                note: this.workoutSessionForm.note.trim() || null
            };
            try {
                if (this.editingSessionId) {
                    const updated = await DB.WorkoutSessions.update(this.editingSessionId, patch);
                    this.workoutSessions = this.workoutSessions.map(s => s.id === updated.id ? updated : s);
                } else {
                    const created = await DB.WorkoutSessions.create(this.workoutEntry.id, patch);
                    this.workoutSessions = [...this.workoutSessions, created];
                }
                this.showSessionForm = false;
                this.editingSessionId = null;
            } catch (e) {
                this.errorMsg = e.message;
            }
        },
        async deleteWorkoutSession(id) {
            const confirmed = await askConfirm('Delete this workout session?');
            if (!confirmed) return;
            try {
                await DB.WorkoutSessions.remove(id);
                this.workoutSessions = this.workoutSessions.filter(s => s.id !== id);
            } catch (e) {
                this.errorMsg = e.message;
            }
        },

        async deleteSleepEntry() {
            const entry = this.sleepEntry;
            if (!entry) return;
            const confirmed = await askConfirm('Delete today\'s sleep log?');
            if (!confirmed) return;
            try {
                await DB.Sleep.softDelete(entry.id);
                this.sleepEntry = null;
                showUndoToast('Sleep log deleted', async () => {
                    this.sleepEntry = await DB.Sleep.restoreFromTrash(entry.id);
                });
            } catch (e) {
                this.errorMsg = e.message;
            }
        },

        async deleteWorkoutEntry() {
            const entry = this.workoutEntry;
            if (!entry) return;
            const confirmed = await askConfirm('Delete today\'s workout log?');
            if (!confirmed) return;
            try {
                await DB.Workout.softDelete(entry.id);
                this.workoutEntry = null;
                this.workoutSessions = [];
                showUndoToast('Workout log deleted', async () => {
                    this.workoutEntry = await DB.Workout.restoreFromTrash(entry.id);
                });
            } catch (e) {
                this.errorMsg = e.message;
            }
        },

        // ---- health trends ----
        sleepTrendDays: [],
        sleepGoalMinutes: 420,
        workoutTrendWeeks: [],
        _workoutTrendTargets: [],
        healthTrendLoading: false,

        async loadHealthTrend() {
            this.healthTrendLoading = true;
            try {
                const [sleepLogs, settings, workoutLogs, targets] = await Promise.all([
                    DB.Sleep.listRecent(30),
                    DB.HealthSettings.get(),
                    DB.Workout.listRecent(28),
                    DB.WorkoutTargets.list()
                ]);
                if (settings && settings.sleep_goal_minutes) this.sleepGoalMinutes = settings.sleep_goal_minutes;

                // Sleep: build 30-day array (newest first from DB, reverse for chart)
                const sleepByDate = {};
                (sleepLogs || []).forEach(s => { sleepByDate[s.entry_date] = s; });
                const today = new Date();
                const sleepDays = [];
                for (let i = 29; i >= 0; i--) {
                    const d = new Date(today);
                    d.setDate(d.getDate() - i);
                    const key = d.toLocaleDateString('en-CA');
                    const entry = sleepByDate[key];
                    sleepDays.push({
                        date: key,
                        label: d.getDate(),
                        duration: entry ? entry.duration_minutes : null,
                        score: entry ? entry.sleep_score : null
                    });
                }
                this.sleepTrendDays = sleepDays;

                // Workout: 4-week consistency grid (per activity type)
                const workoutByDate = {};
                (workoutLogs || []).forEach(w => { workoutByDate[w.entry_date] = w; });
                // Get sessions for last 28 days
                const fourWeeksAgo = new Date(today);
                fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 27);
                const startStr = fourWeeksAgo.toLocaleDateString('en-CA');
                const endStr = today.toLocaleDateString('en-CA');
                let sessions = [];
                try { sessions = await DB.WorkoutSessions.listForDateRange(startStr, endStr); } catch(e) {}

                // Group sessions by week (Mon-Sun) and activity_type
                const weeks = [];
                for (let w = 0; w < 4; w++) {
                    const weekStart = new Date(fourWeeksAgo);
                    weekStart.setDate(weekStart.getDate() + (w * 7));
                    const weekEnd = new Date(weekStart);
                    weekEnd.setDate(weekEnd.getDate() + 6);
                    const wStart = weekStart.toLocaleDateString('en-CA');
                    const wEnd = weekEnd.toLocaleDateString('en-CA');
                    const weekLabel = 'W' + (w + 1);
                    const weekSessions = sessions.filter(s => {
                        const d = s.atlas_workout_logs?.entry_date;
                        return d && d >= wStart && d <= wEnd;
                    });
                    weeks.push({ label: weekLabel, sessions: weekSessions, start: wStart, end: wEnd });
                }
                this.workoutTrendWeeks = weeks;
                this._workoutTrendTargets = targets || [];
            } catch (e) {
                console.error('[HealthTrend]', e);
            }
            this.healthTrendLoading = false;
        },

        get sleepAvg7() {
            const recent = this.sleepTrendDays.slice(-7).filter(d => d.duration != null);
            if (!recent.length) return null;
            return Math.round(recent.reduce((a, d) => a + d.duration, 0) / recent.length);
        },

        get sleepMaxDuration() {
            const durations = this.sleepTrendDays.filter(d => d.duration != null).map(d => d.duration);
            return durations.length ? Math.max(...durations, this.sleepGoalMinutes) : this.sleepGoalMinutes;
        },

        sleepBarHeight(day) {
            if (day.duration == null) return '0%';
            return Math.round((day.duration / this.sleepMaxDuration) * 100) + '%';
        },

        sleepBarColor(day) {
            if (day.duration == null) return 'var(--surface-2)';
            if (day.duration >= this.sleepGoalMinutes) return 'var(--accent-sage)';
            if (day.duration >= this.sleepGoalMinutes * 0.85) return 'var(--accent-amber)';
            return 'var(--accent-coral)';
        },

        get sleepGoalPct() {
            return Math.round((this.sleepGoalMinutes / this.sleepMaxDuration) * 100) + '%';
        },

        // ---- sleep sparkline (Comet review, Option B) ----
        // Only real logged nights become points -- a missing night is a gap
        // in the line, never a fake zero/flat-carry value. Coordinate space
        // is a fixed 280x80 viewBox rendered with preserveAspectRatio="none"
        // so the SVG stretches to whatever width the panel actually has.
        //
        // `segmentsSvg` (Phase 6 fix, 2026-07-28): the colored per-night
        // line segments used to be a `segments` array looped with
        // `<template x-for>` *inside* the <svg> element. SVG content parses
        // in a different namespace than HTML, so a <template> there isn't a
        // real HTMLTemplateElement -- Alpine's directive walker can't read
        // .content off it, which is what threw "Cannot read properties of
        // undefined (reading 'children')" and "seg is not defined" in the
        // console. Fix: precompute the <line> tags as one markup string
        // here and inject it with x-html on a <g> in index.html -- x-html
        // just sets innerHTML, no template-cloning involved, same safe
        // pattern sessionIconSvg() below already uses for the workout
        // session icons (also injected into an <svg> via x-html, and it
        // works fine). Same at-a-glance sage/coral-vs-goal colouring as
        // before, same colour language sleepBarColor() used to give the
        // old bar chart -- only how the markup reaches the DOM changed.
        get sleepSparkline() {
            const days = this.sleepTrendDays.slice(-14).filter(d => d.duration != null);
            if (days.length < 2) return null;
            const values = days.map(d => d.duration);
            const min = Math.min(...values, this.sleepGoalMinutes);
            const max = Math.max(...values, this.sleepGoalMinutes);
            const range = Math.max(1, max - min);
            const W = 280, H = 80, PAD = 6;
            const points = days.map((d, i) => {
                const x = days.length === 1 ? 0 : Math.round((i / (days.length - 1)) * W * 10) / 10;
                const y = Math.round((PAD + (1 - (d.duration - min) / range) * (H - PAD * 2)) * 10) / 10;
                
                const dateObj = new Date(d.date + 'T00:00:00');
                const fmtDate = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                const fmtDur = `${Math.floor(d.duration / 60)}h ${d.duration % 60}m`;
                
                return { x, y, date: d.date, duration: d.duration, above: d.duration >= this.sleepGoalMinutes, fmtDate, fmtDur };
            });
            const linePoints = points.map(p => `${p.x},${p.y}`).join(' ');
            const areaPoints = `0,${H} ${linePoints} ${W},${H}`;
            const goalY = Math.round((PAD + (1 - (this.sleepGoalMinutes - min) / range) * (H - PAD * 2)) * 10) / 10;
            let segmentsSvg = '';
            for (let i = 0; i < points.length - 1; i++) {
                const cls = points[i].above ? 'above' : 'below';
                segmentsSvg += `<line class="health-spark-line ${cls}" x1="${points[i].x}" y1="${points[i].y}" x2="${points[i + 1].x}" y2="${points[i + 1].y}"></line>`;
            }
            const last = points[points.length - 1];
            return { points, linePoints, areaPoints, goalY, last, segmentsSvg, W, H };
        },

        get workoutConsistency() {
            const targets = this._workoutTrendTargets || [];
            return targets.map(t => {
                const weekDots = this.workoutTrendWeeks.map(week => {
                    const count = week.sessions.filter(s => s.activity_type === t.activity_type).length;
                    const target = t.target_days_per_week;
                    if (count >= target) return 'met';
                    if (count > 0) return 'partial';
                    return 'missed';
                });
                return { type: t.activity_type, target: t.target_days_per_week, weekDots };
            });
        },

        // ---- 4-week consistency, aggregated per week (Comet review, Option A) ----
        // Derived from workoutConsistency (unchanged) -- no new data loading.
        // A week is 'met' only if every activity type hit its target that
        // week, 'missed' only if none did, otherwise 'partial'.
        get workoutWeekAggregate() {
            const rows = this.workoutConsistency;
            if (!rows.length) return [];
            return this.workoutTrendWeeks.map((week, i) => {
                const states = rows.map(r => r.weekDots[i]);
                let state;
                if (states.every(s => s === 'met')) state = 'met';
                else if (states.every(s => s === 'missed')) state = 'missed';
                else state = 'partial';
                
                const s = new Date(week.start + 'T00:00:00');
                const e = new Date(week.end + 'T00:00:00');
                const sMon = s.toLocaleString('en-US', { month: 'short' });
                const eMon = e.toLocaleString('en-US', { month: 'short' });
                const range = sMon === eMon ? `${sMon} ${s.getDate()}–${e.getDate()}` : `${sMon} ${s.getDate()}–${eMon} ${e.getDate()}`;
                
                return { label: week.label, state, range, sessionCount: week.sessions.length };
            });
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
