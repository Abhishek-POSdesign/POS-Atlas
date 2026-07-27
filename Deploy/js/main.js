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

// Combined "MMM D · h:mmA" label for the right side of a trv2-row --
// shared by Today's dashboard task list and every Project workspace
// Tasks section (both use the same .trv2-row markup). Pure display
// formatting, same pattern as formatTime12h above -- no data change.
window.formatTaskDateTime = function(dateStr, timeStr) {
    let out = '';
    if (dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        out = isNaN(d) ? dateStr : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    if (timeStr) {
        const t = window.formatTime12h(timeStr);
        out = out ? (out + ' · ' + t) : t;
    }
    return out;
};

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch(err => {
            console.error('ServiceWorker registration failed: ', err);
        });
    });
}

document.addEventListener('alpine:init', () => {
    // Universal time picker (Round 2 build, 2026-07-26).
    // Replaces the three-select dropdown (which rendered as invisible/blank
    // text on dark theme -- direct feedback from live testing) with two
    // numeric inputs + an AM/PM segmented control. `.value` is still the
    // canonical "HH:MM" 24-hour string so no consumer's read/write code
    // changes; only the markup at each callsite is different. Drop-in
    // replacement, universal across every consumer (Today's add/edit modal,
    // workspace add/edit modal, checklist Log popup). Under 60 lines.
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
            if (!this.value) return 'AM';
            let h = parseInt(this.value.split(':')[0], 10);
            if (isNaN(h)) return 'AM';
            return h >= 12 ? 'PM' : 'AM';
        },
        // Called from the HH input on every keystroke. Accepts 1-2 digit
        // strings and clamps to 1-12; empty string clears the whole value.
        updateHH(raw) {
            const s = (raw || '').replace(/[^0-9]/g, '').slice(0, 2);
            if (!s) { this.value = ''; return; }
            let hn = parseInt(s, 10);
            if (isNaN(hn) || hn < 1) hn = 12;
            if (hn > 12) hn = 12;
            this._commit(String(hn).padStart(2, '0'), this.mm || '00', this.ampm);
        },
        // Called from the MM input. Clamps to 0-59; empty string keeps
        // whatever hour was already set with :00 as the minute.
        updateMM(raw) {
            const s = (raw || '').replace(/[^0-9]/g, '').slice(0, 2);
            let mn = s === '' ? 0 : parseInt(s, 10);
            if (isNaN(mn) || mn < 0) mn = 0;
            if (mn > 59) mn = 59;
            const currentHH = this.hh || '12';
            this._commit(currentHH, String(mn).padStart(2, '0'), this.ampm);
        },
        // Called from the AM/PM segmented control. Flips the tail of a
        // set-time; if nothing was set, seeds 12:00.
        updateAMPM(p) {
            const currentHH = this.hh || '12';
            const currentMM = this.mm || '00';
            this._commit(currentHH, currentMM, p);
        },
        _commit(h, m, p) {
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
