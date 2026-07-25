import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/+esm';
import { initAuth, getSession, onSessionChange, signOut } from './auth.js';
import { themeSwitcher } from './components/theme-switcher.js';
import { loginForm } from './components/login-form.js';
import { undoToastHost } from './components/undo-toast.js';
import { confirmDialogHost } from './components/confirm-dialog.js';
import { notePromptHost } from './components/note-prompt.js';
import { projectCard } from './components/project-card.js';
import { todayPage } from './pages/today.js';
import { projectsListPage } from './pages/projects-list.js';
import { projectWorkspacePage } from './pages/project-workspace.js';
import { notebookPage } from './pages/notebook.js';
import { restorePage } from './pages/restore.js';
import { checklistPage } from './pages/checklist.js';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch(err => {
            console.error('ServiceWorker registration failed: ', err);
        });
    });
}

document.addEventListener('alpine:init', () => {
    Alpine.data('themeSwitcher', themeSwitcher);
    Alpine.data('loginForm', loginForm);
    Alpine.data('undoToastHost', undoToastHost);
    Alpine.data('confirmDialogHost', confirmDialogHost);
    Alpine.data('notePromptHost', notePromptHost);
    Alpine.data('projectCard', projectCard);
    Alpine.data('todayPage', todayPage);
    Alpine.data('projectsListPage', projectsListPage);
    Alpine.data('projectWorkspacePage', projectWorkspacePage);
    Alpine.data('notebookPage', notebookPage);
    Alpine.data('restorePage', restorePage);
    Alpine.data('checklistPage', checklistPage);

    Alpine.data('app', () => ({
        authReady: false,
        session: null,
        tab: 'today',
        overlay: null, // null | 'notebook' | 'restore'
        projectViewId: null,

        async init() {
            this.session = await initAuth();
            this.authReady = true;
            onSessionChange((s) => { this.session = s; });
        },
        async doSignOut() {
            await signOut();
            this.tab = 'today';
            this.overlay = null;
            this.projectViewId = null;
        },
        openProject(id) {
            this.projectViewId = id;
        },
        closeProject() {
            this.projectViewId = null;
        },
        setTab(name) {
            this.tab = name;
            this.projectViewId = null;
            this.overlay = null;
        },
        toggleOverlay(name) {
            this.overlay = this.overlay === name ? null : name;
        }
    }));
});

window.Alpine = Alpine;
Alpine.start();
