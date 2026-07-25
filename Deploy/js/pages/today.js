import { DB } from '../db.js';
import { getLogicalDate, todayKey } from '../date-utils.js';

export function todayPage(nav = {}) {
    return {
        goToChecklist() { if (nav.onGoToChecklist) nav.onGoToChecklist(); },
        tasks: [],
        projects: [],
        checklistItems: [],
        checklistDoneCount: 0,
        loading: true,
        errorMsg: '',
        async init() {
            await this.load();
        },
        async load() {
            this.loading = true;
            this.errorMsg = '';
            try {
                const today = todayKey();
                const dow = getLogicalDate().getDay();
                const [tasks, projects, checklistItems, checklistHistory] = await Promise.all([
                    DB.Tasks.listActive(),
                    DB.Projects.listActive(),
                    DB.Checklist.listItems(),
                    DB.Checklist.listHistoryForDate(today)
                ]);
                this.tasks = tasks;
                this.projects = projects;
                this.checklistItems = checklistItems.filter(i => !i.days || i.days.includes(dow));
                const doneIds = new Set(checklistHistory.filter(h => h.status === 'done').map(h => h.item_id));
                this.checklistDoneCount = this.checklistItems.filter(i => doneIds.has(i.id)).length;
            } catch (e) {
                this.errorMsg = 'Could not load Today: ' + e.message;
            }
            this.loading = false;
        },
        get checklistTotalToday() {
            return this.checklistItems.length;
        },
        get upcomingTasks() {
            return this.tasks.filter(t => t.status !== 'done').slice(0, 20);
        },
        get activeProjectCount() {
            return this.projects.length;
        },
        get inProgressProjectCount() {
            return this.projects.filter(p => p.status === 'in_progress').length;
        }
    };
}
