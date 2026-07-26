import { DB } from '../db.js';
import { showUndoToast } from '../components/undo-toast.js';
import { askConfirm } from '../components/confirm-dialog.js';
import { askNote } from '../components/note-prompt.js';
import { groupByDate } from '../date-groups.js';

export function projectWorkspacePage(nav) {
    return {
        projectId: null,
        project: null,
        tasks: [],
        logs: [],
        loading: false,
        errorMsg: '',
        editingHeader: false,
        headerForm: { short_term_goal: '', short_term_goal_date: '', long_term_goal: '', long_term_goal_date: '' },
        // Task modal (Round 2 build, items 10 + 13). Same shape as Today's
        // task modal. Add + edit both use this one modal; editingTaskId
        // decides which mode. Persistent add-task row + inline edit both
        // removed in favour of this modal.
        taskModalOpen: false,
        editingTaskId: null,
        taskForm: { name: '', scheduled_date: '', scheduled_time: '', notify_enabled: false },
        newLogBody: '',
        editingLogId: null,
        editingLogBody: '',
        expandedDates: {},
        async open(id) {
            this.projectId = id;
            await this.load();
        },
        async load() {
            if (!this.projectId) return;
            this.loading = true;
            this.errorMsg = '';
            try {
                const [project, tasks, logs] = await Promise.all([
                    DB.Projects.getById(this.projectId),
                    DB.Tasks.listForProject(this.projectId),
                    DB.TaskLogs.listForProject(this.projectId)
                ]);
                this.project = project;
                this.tasks = tasks;
                this.logs = logs;
            } catch (e) {
                this.errorMsg = 'Could not load project: ' + e.message;
            }
            this.loading = false;
        },
        get runningTask() {
            return this.tasks.find(t => t.status === 'in_progress') || null;
        },
        get logGroups() {
            return groupByDate(this.logs, l => l.entry_date);
        },

        // ---- Hero-header summary metrics (added for the redesigned
        // workspace 2026-07-26). Purely derived from state.tasks + project
        // dates; no separate fetch. ----
        get doneCount() { return this.tasks.filter(t => t.status === 'done').length; },
        get totalCount() { return this.tasks.length; },
        get inProgressCount() { return this.tasks.filter(t => t.status === 'in_progress').length; },
        get notStartedCount() { return this.tasks.filter(t => t.status === 'not_started').length; },
        get progressPct() { return this.totalCount ? Math.round((this.doneCount / this.totalCount) * 100) : 0; },
        statusLabel(s) {
            if (s === 'in_progress') return 'In progress';
            if (s === 'planned') return 'Planned';
            if (s === 'completed') return 'Completed';
            return s || '';
        },
        formatDate(iso) {
            if (!iso) return '';
            const d = new Date(iso + 'T00:00:00');
            if (isNaN(d)) return iso;
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        },
        daysUntil(iso) {
            if (!iso) return '';
            const d = new Date(iso + 'T00:00:00');
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const diff = Math.round((d - today) / 86400000);
            if (diff === 0) return 'Due today';
            if (diff === 1) return 'Due tomorrow';
            if (diff > 0) return diff + ' days';
            if (diff === -1) return '1 day overdue';
            return Math.abs(diff) + ' days overdue';
        },
        projectDotClass() {
            return 'color-' + (this.project?.color_key || 'blue');
        },
        isDateExpanded(date) {
            return this.expandedDates[date] !== false; // expanded by default
        },
        toggleDate(date) {
            this.expandedDates[date] = !this.isDateExpanded(date);
        },
        back() {
            nav.onBack();
        },
        startEditHeader() {
            this.headerForm = {
                short_term_goal: this.project.short_term_goal || '',
                short_term_goal_date: this.project.short_term_goal_date || '',
                long_term_goal: this.project.long_term_goal || '',
                long_term_goal_date: this.project.long_term_goal_date || ''
            };
            this.editingHeader = true;
        },
        async saveHeader() {
            try {
                this.project = await DB.Projects.update(this.projectId, { ...this.headerForm });
                this.editingHeader = false;
            } catch (e) {
                this.errorMsg = 'Save failed: ' + e.message;
            }
        },
        // ---- Task modal (add + edit both use this one modal) ----
        openAddTaskModal() {
            this.editingTaskId = null;
            this.taskForm = { name: '', scheduled_date: '', scheduled_time: '', notify_enabled: false };
            this.taskModalOpen = true;
        },
        openEditTaskModal(task) {
            this.editingTaskId = task.id;
            this.taskForm = {
                name: task.name || '',
                scheduled_date: task.scheduled_date || '',
                scheduled_time: task.scheduled_time ? task.scheduled_time.slice(0, 5) : '',
                notify_enabled: !!task.notify_enabled
            };
            this.taskModalOpen = true;
        },
        closeTaskModal() {
            this.taskModalOpen = false;
            this.editingTaskId = null;
        },
        async submitTaskModal() {
            const name = this.taskForm.name.trim();
            if (!name) return;
            const patch = {
                name,
                scheduled_date: this.taskForm.scheduled_date || null,
                scheduled_time: this.taskForm.scheduled_time || null,
                notify_enabled: this.taskForm.notify_enabled
            };
            try {
                if (this.editingTaskId) {
                    const row = await DB.Tasks.update(this.editingTaskId, patch);
                    this.tasks = this.tasks.map(t => t.id === row.id ? row : t);
                } else {
                    const row = await DB.Tasks.create({
                        ...patch,
                        project_id: this.projectId,
                        kind: 'task',
                        status: 'not_started',
                        priority: 'normal'
                    });
                    this.tasks = [...this.tasks, row];
                }
                this.taskModalOpen = false;
                this.editingTaskId = null;
            } catch (e) {
                this.errorMsg = 'Save failed: ' + e.message;
            }
        },
        // Called from the Delete button inside the task edit modal (Round 2
        // build, items 9 + 13). Reuses deleteTask for the actual delete +
        // undo-toast flow -- just also closes the modal on success.
        async deleteFromEditModal() {
            if (!this.editingTaskId) return;
            const task = this.tasks.find(t => t.id === this.editingTaskId);
            if (!task) { this.closeTaskModal(); return; }
            const before = this.tasks;
            await this.deleteTask(task);
            if (this.tasks !== before) this.closeTaskModal();
        },

        async startTask(task) {
            const note = await askNote(`What are you doing right now on "${task.name}"?`, {
                submitLabel: 'Start', skipLabel: 'Just start'
            });
            try {
                const updated = await DB.Tasks.start(task.id, note);
                this.tasks = this.tasks.map(t => t.id === updated.id ? updated : t);
            } catch (e) {
                this.errorMsg = 'Start failed: ' + e.message;
            }
        },
        // Two-step done confirmation, matching the Today Tasks & Reminders
        // card. First click on the round checkbox arms the row (pending
        // state); second click within 2.5s commits. Prevents an accidental
        // tap from marking a task done. Delete already has askConfirm() +
        // undo toast, so it already has two steps + a safety net.
        pendingCompleteId: null,
        _pendingCompleteTimer: null,
        isPendingComplete(task) { return this.pendingCompleteId === task.id; },
        handleCompleteClick(task) {
            if (this.pendingCompleteId === task.id) {
                this._clearPendingComplete();
                this.completeTask(task);
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

        // Complete-task on workspace: no separate note prompt (the double-tap
        // confirm IS the deliberate second action). Still auto-creates a
        // Work log entry so the completion is auditable in the project's own
        // timeline -- Abhishek can hand-add a richer note as a normal Work
        // log entry, or via Edit task, if he wants one.
        async completeTask(task) {
            try {
                const updated = await DB.Tasks.complete(task.id, null);
                this.tasks = this.tasks.map(t => t.id === updated.id ? updated : t);
                const logRow = await DB.TaskLogs.create({
                    project_id: this.projectId,
                    task_id: task.id,
                    body: `Completed: ${task.name}`,
                    entry_type: 'task_completion'
                });
                this.logs = [logRow, ...this.logs];
            } catch (e) {
                this.errorMsg = 'Complete failed: ' + e.message;
            }
        },
        async deleteTask(task) {
            const ok = await askConfirm(`Delete task "${task.name}"? You can restore it from the Restore view afterward.`);
            if (!ok) return;
            const snapshot = this.tasks;
            this.tasks = this.tasks.filter(t => t.id !== task.id);
            try {
                await DB.Tasks.softDelete(task.id);
                showUndoToast(`Deleted task "${task.name}"`, async () => {
                    await DB.Tasks.restoreFromTrash(task.id);
                    await this.load();
                });
            } catch (e) {
                this.tasks = snapshot;
                this.errorMsg = 'Delete failed: ' + e.message;
            }
        },
        async addLog() {
            const body = this.newLogBody.trim();
            if (!body) return;
            try {
                const row = await DB.TaskLogs.create({ project_id: this.projectId, body, entry_type: 'narrative' });
                this.logs = [row, ...this.logs];
                this.newLogBody = '';
            } catch (e) {
                this.errorMsg = 'Log entry failed: ' + e.message;
            }
        },
        startEditLog(log) {
            this.editingLogId = log.id;
            this.editingLogBody = log.body;
        },
        cancelEditLog() {
            this.editingLogId = null;
            this.editingLogBody = '';
        },
        async saveEditLog(log) {
            const body = this.editingLogBody.trim();
            if (!body) return;
            try {
                const updated = await DB.TaskLogs.update(log.id, { body });
                this.logs = this.logs.map(l => l.id === updated.id ? updated : l);
                this.cancelEditLog();
            } catch (e) {
                this.errorMsg = 'Log edit failed: ' + e.message;
            }
        },
        formatTime(iso) {
            if (!iso) return '';
            const d = new Date(iso);
            return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
        },
        async archiveProject() {
            try {
                this.project = await DB.Projects.archive(this.projectId);
            } catch (e) {
                this.errorMsg = 'Archive failed: ' + e.message;
            }
        },
        async softDeleteProject() {
            const ok = await askConfirm(`Delete "${this.project.name}" and everything in it (tasks, work log)? You can restore it from the Restore view afterward.`);
            if (!ok) return;
            const name = this.project.name;
            const projectId = this.projectId;
            try {
                await DB.Projects.softDelete(projectId);
                showUndoToast(`Deleted "${name}"`, async () => {
                    await DB.Projects.restoreFromTrash(projectId);
                });
                nav.onBack();
            } catch (e) {
                this.errorMsg = 'Delete failed: ' + e.message;
            }
        }
    };
}
