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
        newTaskName: '',
        newTaskDate: '',
        newTaskTime: '',
        newTaskNotify: false,
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
        async addTask() {
            const name = this.newTaskName.trim();
            if (!name) return;
            try {
                const created = await DB.Tasks.create({
                    project_id: this.projectId,
                    name,
                    scheduled_date: this.newTaskDate || null,
                    scheduled_time: this.newTaskTime || null,
                    notify_enabled: this.newTaskNotify
                });
                this.tasks = [...this.tasks, created];
                this.newTaskName = '';
                this.newTaskDate = '';
                this.newTaskTime = '';
                this.newTaskNotify = false;
            } catch (e) {
                this.errorMsg = 'Add task failed: ' + e.message;
            }
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
        async completeTask(task) {
            const note = await askNote(`Anything worth noting about finishing "${task.name}"?`, {
                submitLabel: 'Complete', skipLabel: 'Complete without a note'
            });
            try {
                const updated = await DB.Tasks.complete(task.id, note);
                this.tasks = this.tasks.map(t => t.id === updated.id ? updated : t);
                const logRow = await DB.TaskLogs.create({
                    project_id: this.projectId,
                    task_id: task.id,
                    body: `Completed: ${task.name}${note ? ' — ' + note : ''}`,
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
            return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
