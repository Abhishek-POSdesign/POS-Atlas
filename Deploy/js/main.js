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
import { calendarPage } from './pages/calendar.js';
import { atlasAi } from './ui/aiPanel.js';

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

// Day-first "D Mon YYYY" date label (e.g. "29 Jul 2026") -- added 2026-07-31
// after direct feedback that a raw ISO string (YYYY-MM-DD) reads in
// year-month-day order, not the day-first order used in India. Day-first
// with a written month name avoids the classic MM/DD vs DD/MM ambiguity a
// pure numeric format would still carry. Currently used by the Notebook's
// entry list; not yet a blanket replacement for every date display in the
// app (most others already use a month-name format like formatTaskDateTime
// above, which has no day/month ordering ambiguity to begin with).
window.formatDateDMY = function(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // updateViaCache: 'none' (2026-07-28 fix) -- without this, the
        // browser's own HTTP cache can serve a stale copy of
        // service-worker.js itself when checking for updates, meaning a
        // new deploy sometimes goes unnoticed and a normal reload can
        // land back on an old cached shell. This forces the SW update
        // check to always hit the network for the SW script itself.
        navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }).catch(err => {
            console.error('ServiceWorker registration failed: ', err);
        });
    });

    // The missing half of the 2026-07-28 fix above -- that one stopped the
    // browser from serving a stale service-worker.js file, but a tab can
    // still get caught between the OLD and NEW service worker mid-update:
    // skipWaiting()/clients.claim() (service-worker.js) make the new worker
    // take over quickly, but not necessarily on the exact reload that
    // triggered the update check -- one reload can still land under the
    // outgoing worker's cached JS/CSS, the next under the new one, which is
    // exactly the "vanishes, then comes back" flicker reported live
    // 2026-08-07. `controllerchange` fires the instant a new worker actually
    // takes control; forcing one reload right then guarantees every asset
    // on screen comes from the same, current version. `refreshing` guards
    // against the rare double-fire some browsers are known to produce.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
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
    Alpine.data('calendarPage', calendarPage);
    Alpine.data('atlasAi', atlasAi);

    // Reload used to always land back on Today regardless of where you were
    // (direct feedback, 2026-08-07) -- tab/projectViewId only ever lived in
    // memory. Read once at module load, restored in init() below; every
    // change is persisted via $watch so this stays correct with zero extra
    // calls at any of the many places that already set tab/projectViewId.
    let _restoredNav = { tab: 'today', projectViewId: null };
    try {
        const raw = localStorage.getItem('atlas_last_nav');
        if (raw) _restoredNav = { ..._restoredNav, ...JSON.parse(raw) };
    } catch (e) { /* corrupt/old value -- fall back to defaults */ }
    if (!['today', 'projects', 'routine', 'calendar'].includes(_restoredNav.tab)) _restoredNav.tab = 'today';
    if (_restoredNav.tab !== 'projects') _restoredNav.projectViewId = null;

    Alpine.data('app', () => ({
        authReady: false,
        session: null,
        tab: _restoredNav.tab,
        overlay: null, // null | 'notebook' | 'restore'
        projectViewId: _restoredNav.projectViewId,

        // ---- Snooze picker (2026-08-06) ----
        // Global, not owned by any one page's x-data, since a push
        // notification's "Snooze" tap can land on whatever tab happens to
        // be open (or none, if the app was closed) -- push-client.js
        // dispatches a plain window event rather than reaching into a
        // specific page's Alpine scope.
        snoozePickerOpen: false,
        snoozeTaskId: null,
        snoozeError: '',

        async init() {
            this.session = await initAuth();
            this.authReady = true;
            onSessionChange((s) => { this.session = s; });
            const persistNav = () => localStorage.setItem('atlas_last_nav', JSON.stringify({ tab: this.tab, projectViewId: this.projectViewId }));
            this.$watch('tab', persistNav);
            this.$watch('projectViewId', persistNav);
            window.addEventListener('atlas:snooze-request', (e) => {
                this.snoozeTaskId = e.detail.taskId;
                this.snoozeError = '';
                this.snoozePickerOpen = true;
            });
        },
        closeSnoozePicker() {
            this.snoozePickerOpen = false;
            this.snoozeTaskId = null;
        },
        async chooseSnooze(minutes) {
            const result = await applySnooze(this.snoozeTaskId, minutes);
            if (result.ok) {
                this.closeSnoozePicker();
            } else {
                this.snoozeError = result.error || 'Could not snooze. Please try again.';
            }
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

import { PushClient, applySnooze } from './push-client.js';
window.PushClient = PushClient;

