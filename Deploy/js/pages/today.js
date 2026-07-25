import { DB } from '../db.js';

export function todayPage() {
    return {
        tasks: [],
        projects: [],
        loading: true,
        errorMsg: '',
        async init() {
            await this.load();
        },
        async load() {
            this.loading = true;
            this.errorMsg = '';
            try {
                const [tasks, projects] = await Promise.all([
                    DB.Tasks.listActive(),
                    DB.Projects.listActive()
                ]);
                this.tasks = tasks;
                this.projects = projects;
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
        }
    };
}
