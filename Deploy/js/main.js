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

window.formatTime12h = function(timeStr) {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    let h = parseInt(parts[0], 10);
    const m = parts[1];
    if (isNaN(h)) return timeStr;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
};

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch(err => {
            console.error('ServiceWorker registration failed: ', err);
        });
    });
}

document.addEventListener('alpine:init', () => {
    Alpine.data('timePicker12h', () => ({
        value: '',
        get hh() {
            if (!this.value) return '';
            let h = parseInt(this.value.split(':')[0], 10);
            if (isNaN(h)) return '';
            if (h === 0) return '12';
            if (h > 12) return String(h - 12).padStart(2, '0');
            return String(h).padStart(2, '0');
        },
        get mm() {
            if (!this.value) return '';
            let m = this.value.split(':')[1];
            return m ? m.slice(0, 2) : '00';
        },
        get ampm() {
            if (!this.value) return '';
            let h = parseInt(this.value.split(':')[0], 10);
            if (isNaN(h)) return 'AM';
            return h >= 12 ? 'PM' : 'AM';
        },
        update(h, m, p) {
            if (!h) { this.value = ''; return; }
            let hour = parseInt(h, 10);
            let min = m || '00';
            let ampm = p || 'AM';
            if (ampm === 'PM' && hour !== 12) hour += 12;
            if (ampm === 'AM' && hour === 12) hour = 0;
            this.value = String(hour).padStart(2, '0') + ':' + min;
        }
    }));

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
