import { DB } from '../db.js';
import { showUndoToast } from '../components/undo-toast.js';
import { askConfirm } from '../components/confirm-dialog.js';
import { groupByDate } from '../date-groups.js';
import { toLocalIsoDate } from '../date-utils.js';

// Expanded 2026-07-31 -- was only 4 options, real complaint from live use
// ("if I can get more colors don't put yourself in the boundary"). amber
// was already a locked accent elsewhere but never offered here; the other
// 5 are deep-shade variants of the original 5 hues (see tokens.css), not
// new unrelated colours.
const COLOR_KEYS = ['sage', 'blue', 'lilac', 'coral', 'amber', 'forest', 'indigo', 'plum', 'rust', 'bronze'];

export function projectsListPage(nav) {
    return {
        projects: [],
        tasksByProject: {},
        loading: true,
        errorMsg: '',
        showModal: false,
        editingProject: null,
        colorKeys: COLOR_KEYS,
        form: { name: '', color_key: 'sage', monogram_letter: '', description: '', short_term_goal: '', short_term_goal_date: '', long_term_goal: '', long_term_goal_date: '' },
        // New Project modal now supports adding notes-mode (item 6, Round 2
        // build) via a modal instead of the persistent Notes card. Note
        // modal is a separate simple form.
        showNoteModal: false,
        // Projects-page-level notes (moved out of the per-project workspace,
        // 2026-07-25 testing feedback). Composer stays collapsed until
        // explicitly opened so the page doesn't accumulate open textareas.
        notes: [],
        newNoteBody: '',
        addingNote: false,
        expandedNoteDates: {},
        async init() {
            await this.load();
        },
        async load() {
            this.loading = true;
            this.errorMsg = '';
            try {
                const [projects, tasks, notes] = await Promise.all([
                    DB.Projects.listActive(),
                    DB.Tasks.listActive(),
                    DB.ProjectNotes.listGlobal()
                ]);
                this.projects = projects;
                this.notes = notes;
                const byProject = {};
                for (const t of tasks) {
                    if (!t.project_id) continue;
                    (byProject[t.project_id] ||= []).push(t);
                }
                this.tasksByProject = byProject;
            } catch (e) {
                this.errorMsg = 'Could not load projects: ' + e.message;
            }
            this.loading = false;
        },
        tasksFor(projectId) {
            return this.tasksByProject[projectId] || [];
        },
        openCreate() {
            this.editingProject = null;
            this.form = {
                name: '', color_key: 'sage', monogram_letter: '', description: '',
                short_term_goal: '', short_term_goal_date: '',
                long_term_goal: '', long_term_goal_date: ''
            };
            this.showModal = true;
        },
        openEdit(project) {
            this.editingProject = project;
            this.form = {
                name: project.name,
                color_key: project.color_key,
                monogram_letter: project.monogram_letter,
                description: project.description || '',
                short_term_goal: project.short_term_goal || '',
                short_term_goal_date: project.short_term_goal_date || '',
                long_term_goal: project.long_term_goal || '',
                long_term_goal_date: project.long_term_goal_date || ''
            };
            this.showModal = true;
        },
        closeModal() {
            this.showModal = false;
        },
        async submitForm() {
            const name = this.form.name.trim();
            if (!name) { this.errorMsg = 'Project name is required.'; return; }
            const monogram = (this.form.monogram_letter || name[0]).toUpperCase().slice(0, 1);
            const goalFields = {
                short_term_goal: this.form.short_term_goal.trim() || null,
                short_term_goal_date: this.form.short_term_goal_date || null,
                long_term_goal: this.form.long_term_goal.trim() || null,
                long_term_goal_date: this.form.long_term_goal_date || null
            };
            try {
                if (this.editingProject) {
                    const updated = await DB.Projects.update(this.editingProject.id, {
                        name, color_key: this.form.color_key, monogram_letter: monogram,
                        description: this.form.description || null,
                        ...goalFields
                    });
                    this.projects = this.projects.map(p => p.id === updated.id ? updated : p);
                } else {
                    const created = await DB.Projects.create({
                        name, color_key: this.form.color_key, monogram_letter: monogram,
                        description: this.form.description || null, status: 'planned',
                        ...goalFields
                    });
                    this.projects = [...this.projects, created];
                }
                this.showModal = false;
            } catch (e) {
                this.errorMsg = 'Save failed: ' + e.message;
            }
        },
        async softDelete(project) {
            const ok = await askConfirm(`Delete "${project.name}" and everything in it (tasks, work log)? You can restore it from the Restore view afterward.`);
            if (!ok) return;
            const snapshot = this.projects;
            this.projects = this.projects.filter(p => p.id !== project.id);
            try {
                await DB.Projects.softDelete(project.id);
                showUndoToast(`Deleted "${project.name}"`, async () => {
                    await DB.Projects.restoreFromTrash(project.id);
                    await this.load();
                });
            } catch (e) {
                this.projects = snapshot;
                this.errorMsg = 'Delete failed: ' + e.message;
            }
        },
        openWorkspace(id) {
            nav.onOpen(id);
        },
        get noteGroups() {
            return groupByDate(this.notes, n => toLocalIsoDate(n.created_at));
        },
        isNoteDateExpanded(date) {
            return this.expandedNoteDates[date] !== false;
        },
        toggleNoteDate(date) {
            this.expandedNoteDates[date] = !this.isNoteDateExpanded(date);
        },
        // Modal-based note composer (Round 2 build, item 6). The persistent
        // Notes card is gone; adding a note opens this modal instead.
        openNoteModal() {
            this.newNoteBody = '';
            this.showNoteModal = true;
        },
        closeNoteModal() {
            this.showNoteModal = false;
            this.newNoteBody = '';
        },
        async addNote() {
            const body = this.newNoteBody.trim();
            if (!body) return;
            try {
                const row = await DB.ProjectNotes.create({ body });
                this.notes = [row, ...this.notes];
                this.newNoteBody = '';
                this.showNoteModal = false;
            } catch (e) {
                this.errorMsg = 'Note failed: ' + e.message;
            }
        },
        async deleteNote(note) {
            const ok = await askConfirm('Delete this note? You can restore it from the Restore view afterward.');
            if (!ok) return;
            const snapshot = this.notes;
            this.notes = this.notes.filter(n => n.id !== note.id);
            try {
                await DB.ProjectNotes.softDelete(note.id);
                showUndoToast('Deleted note', async () => {
                    await DB.ProjectNotes.restoreFromTrash(note.id);
                    await this.load();
                });
            } catch (e) {
                this.notes = snapshot;
                this.errorMsg = 'Delete failed: ' + e.message;
            }
        }
    };
}
