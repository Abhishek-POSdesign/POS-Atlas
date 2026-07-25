import { DB } from '../db.js';

export function restorePage(nav) {
    return {
        deletedProjects: [],
        deletedTasks: [],
        loading: true,
        errorMsg: '',
        confirmingHardDelete: null,
        async init() {
            await this.load();
        },
        close() {
            nav.onClose();
        },
        async load() {
            this.loading = true;
            this.errorMsg = '';
            try {
                const [projects, tasks] = await Promise.all([
                    DB.Projects.listDeleted(),
                    DB.Tasks.listDeleted()
                ]);
                this.deletedProjects = projects;
                this.deletedTasks = tasks;
            } catch (e) {
                this.errorMsg = 'Could not load Restore: ' + e.message;
            }
            this.loading = false;
        },
        async restoreProject(p) {
            try {
                await DB.Projects.restoreFromTrash(p.id);
                await this.load();
            } catch (e) {
                this.errorMsg = 'Restore failed: ' + e.message;
            }
        },
        async restoreTask(t) {
            try {
                await DB.Tasks.restoreFromTrash(t.id);
                await this.load();
            } catch (e) {
                this.errorMsg = 'Restore failed: ' + e.message;
            }
        },
        askHardDeleteProject(p) {
            this.confirmingHardDelete = { kind: 'project', id: p.id, label: p.name };
        },
        askHardDeleteTask(t) {
            this.confirmingHardDelete = { kind: 'task', id: t.id, label: t.name };
        },
        cancelHardDelete() {
            this.confirmingHardDelete = null;
        },
        async confirmHardDelete() {
            const target = this.confirmingHardDelete;
            if (!target) return;
            try {
                if (target.kind === 'project') await DB.Projects.hardDelete(target.id);
                else await DB.Tasks.hardDelete(target.id);
                this.confirmingHardDelete = null;
                await this.load();
            } catch (e) {
                this.errorMsg = 'Permanent delete failed: ' + e.message;
            }
        }
    };
}
