// Props in, DOM out: takes a project row + that project's tasks (already
// fetched by the page in one batch query, so this component never calls
// db.js itself) + callbacks from whichever page renders it.
//
// 2026-07-25 testing feedback: clicking a card used to jump straight into
// the full workspace. Abhishek wants a click to expand an inline summary on
// the Projects page itself instead -- the workspace only opens from an
// explicit action inside that expanded state.

const STATUS_LABEL = {
    planned: 'Planned',
    in_progress: 'In progress',
    completed: 'Completed'
};

export function projectCard(project, tasks, actions) {
    return {
        project,
        tasks: tasks || [],
        menuOpen: false,
        expanded: false,
        get initial() {
            return (this.project.monogram_letter || this.project.name?.[0] || '?').toUpperCase();
        },
        get statusLabel() {
            return STATUS_LABEL[this.project.status] || this.project.status;
        },
        get completedCount() {
            return this.tasks.filter(t => t.status === 'done').length;
        },
        get totalCount() {
            return this.tasks.length;
        },
        get runningTask() {
            return this.tasks.find(t => t.status === 'in_progress') || null;
        },
        get nextTask() {
            const upcoming = this.tasks
                .filter(t => t.status === 'not_started')
                .sort((a, b) => {
                    if (!a.scheduled_date && !b.scheduled_date) return 0;
                    if (!a.scheduled_date) return 1;
                    if (!b.scheduled_date) return -1;
                    return a.scheduled_date.localeCompare(b.scheduled_date)
                        || (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
                });
            return upcoming[0] || null;
        },
        // First click on a collapsed card reveals the summary; clicking an
        // already-expanded card opens the full workspace (2026-07-25 --
        // dropped the big "Open workspace" button in favor of this, plus a
        // small explicit link for anyone who'd rather not double-click).
        handleClick() {
            if (this.expanded) {
                this.openWorkspace();
            } else {
                this.expanded = true;
            }
        },
        openWorkspace() {
            actions.onOpen(this.project.id);
        },
        toggleMenu() {
            this.menuOpen = !this.menuOpen;
        },
        edit() {
            this.menuOpen = false;
            actions.onEdit(this.project);
        },
        remove() {
            this.menuOpen = false;
            actions.onDelete(this.project);
        }
    };
}
