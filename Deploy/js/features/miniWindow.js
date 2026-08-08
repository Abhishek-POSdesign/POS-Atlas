// Atlas -- the floating mini window ("Pop out").
//
// A small always-on-top window showing ONLY today's tasks and reminders, so
// Atlas can sit in the corner of the screen while Abhishek works in something
// else. Approved 2026-08-09 after a feasibility round; his requirements,
// verbatim in spirit:
//   - the big Atlas can be minimised and the small one stays open
//   - closing the big Atlas closes the small one too
//   - it must stay SMALL: about three or four rows visible, scroll for more
//
// Built on the Document Picture-in-Picture API. Two of those three
// requirements are the API's own behaviour, not code we write: the PiP window
// is a real OS-level always-on-top window (so minimising the opener leaves it
// alone), and the browser tears it down when the opener document goes away
// (so closing Atlas closes it). We only have to not fight either one.
//
// Why plain DOM instead of Alpine: this content lives in a DIFFERENT document.
// Alpine is initialised against the main document and moving live x-data DOM
// across documents is exactly the kind of fragile trick that breaks quietly on
// a browser update. Instead the page hands us a plain snapshot of rows plus
// two callbacks, and we re-render on demand. Nothing here talks to Supabase --
// completion goes back through the page's own verified path (db.js), per the
// architecture rule.

let pipWindow = null;
let host = null;

export function isMiniWindowSupported() {
    return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

export function isMiniWindowOpen() {
    return !!(pipWindow && !pipWindow.closed);
}

// Tokens and component CSS have to exist inside the PiP document too --
// stylesheets are per-document. Copying the real <link> tags (rather than
// hardcoding colours here) is what keeps this honest to tokens.css; inventing
// a second palette for this window would violate the token rule outright.
export function adoptStyles(target) {
    for (const node of document.querySelectorAll('link[rel="stylesheet"]')) {
        const link = target.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = node.href;
        target.document.head.appendChild(link);
    }
    const own = target.document.createElement('style');
    own.textContent = MINI_CSS;
    target.document.head.appendChild(own);
}

// Scoped to .mw-* so nothing here can collide with the app's own classes if a
// copied stylesheet happens to define something similar.
const MINI_CSS = `
  html, body {
    margin:0; padding:0; height:100%; overflow:hidden;
    background:var(--surface-0); color:var(--text-primary);
    font-family:var(--font-sans); font-size:15px;
  }
  .mw-shell { display:flex; flex-direction:column; height:100%; }
  .mw-head {
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    padding:9px 12px; background:var(--surface-1);
    border-bottom:1px solid var(--border); flex:none;
  }
  .mw-title {
    font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase;
    color:var(--text-muted);
  }
  .mw-count { font-size:11px; color:var(--text-muted); font-variant-numeric:tabular-nums; }
  .mw-list {
    flex:1; min-height:0; padding:7px; display:flex; flex-direction:column; gap:5px;
    /* Vertical scroll only. A long task name must ellipsis, never widen the
       row -- a horizontal scrollbar appeared across the bottom of the window
       in his first real test, which is exactly the "grows with content"
       behaviour the Today card is already forbidden from doing. */
    overflow-y:auto; overflow-x:hidden;
    scrollbar-width:thin;
    scrollbar-color:var(--border-hover) transparent;
  }
  /* The OS default scrollbar read as a grey slab bolted onto a dark window.
     Slim, transparent-track, token-coloured -- visible enough to grab, quiet
     enough to disappear. Firefox uses scrollbar-width/color above. */
  .mw-list::-webkit-scrollbar { width:8px; }
  .mw-list::-webkit-scrollbar-track { background:transparent; }
  .mw-list::-webkit-scrollbar-thumb {
    background:var(--border-hover); border-radius:99px;
    border:2px solid transparent; background-clip:content-box;
  }
  .mw-list::-webkit-scrollbar-thumb:hover { background:var(--text-muted); background-clip:content-box; }
  .mw-group {
    font-size:9.5px; font-weight:700; letter-spacing:.13em; text-transform:uppercase;
    color:var(--text-muted); padding:5px 3px 1px; flex:none;
  }
  .mw-group:first-child { padding-top:1px; }
  .mw-row {
    display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:9px;
    padding:8px 9px; border-radius:7px; background:var(--surface-1);
    border:1px solid var(--border); flex:none;
  }
  /* Running work carries a blue left edge so the two groups stay separable
     even when the window is squeezed short enough to hide a group heading. */
  .mw-row.running { border-left:3px solid var(--accent-blue); }
  /* Without min-width:0 the middle cell refuses to shrink and the name
     pushes the time column off the edge -- the cause of the overlap and the
     horizontal scrollbar in his screenshot. */
  .mw-body { min-width:0; display:block; }
  .mw-check {
    width:18px; height:18px; border-radius:5px; flex:none; cursor:pointer;
    border:1.5px solid var(--border-hover); background:transparent;
    display:grid; place-items:center; padding:0; color:transparent;
  }
  .mw-check:hover { border-color:var(--accent-sage); }
  .mw-check.armed { border-color:var(--accent-sage); background:var(--accent-sage-tint); }
  .mw-check:focus-visible { outline:2px solid var(--accent-blue); outline-offset:2px; }
  .mw-name {
    display:block; font-size:13.5px; font-weight:500; color:var(--text-primary); line-height:1.3;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  .mw-sub {
    display:block; font-size:11px; color:var(--text-muted); margin-top:2px; line-height:1.3;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  .mw-sub .mw-late { color:var(--accent-coral); }
  .mw-sub .mw-run { color:var(--accent-blue); }
  .mw-sub .mw-arm { color:var(--accent-sage); }
  .mw-time {
    font-size:11.5px; color:var(--text-secondary); white-space:nowrap;
    font-variant-numeric:tabular-nums;
  }
  .mw-chip {
    display:inline-grid; place-items:center; width:15px; height:15px; border-radius:4px;
    font-size:9px; font-weight:700; margin-right:5px; vertical-align:-2px;
  }
  .mw-empty {
    padding:28px 16px; text-align:center; color:var(--text-muted); font-size:13px;
  }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important; animation:none !important; } }
`;

const CHECK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

export const MINI_SHELL_HTML = `
    <div class="mw-shell">
      <div class="mw-head">
        <span class="mw-title">Atlas · Today</span>
        <span class="mw-count"></span>
      </div>
      <div class="mw-list"></div>
    </div>`;

// Split out from renderMiniWindow() so the markup can be exercised against
// any document, not only a live PiP window -- the PiP window can't be opened
// in a headless/embedded browser, which would otherwise leave this template
// completely unverifiable outside a manual desktop test.
export function renderRowsInto(doc, rows) {
    const listEl = doc.querySelector('.mw-list');
    const countEl = doc.querySelector('.mw-count');
    if (!listEl) return;

    if (countEl) countEl.textContent = rows.length ? `${rows.length} open` : '';

    if (!rows.length) {
        listEl.innerHTML = '<div class="mw-empty">Nothing open right now.</div>';
        return;
    }

    // Two labelled groups, not one mixed list. His words: "it is a mix and
    // match, and it is very hard to find which one is running and which one
    // is a pending task." Headings only render when that group has something
    // in it, so a window with no running work doesn't waste a row on an empty
    // "In progress" label.
    const running = rows.filter(r => r.running);
    const pending = rows.filter(r => !r.running);
    listEl.innerHTML =
        (running.length ? `<div class="mw-group">In progress</div>` + rowsHtml(running) : '') +
        (pending.length ? `<div class="mw-group">Tasks &amp; reminders</div>` + rowsHtml(pending) : '');
}

function rowsHtml(rows) {
    return rows.map(r => {
        const cues = [];
        if (r.armed) cues.push('<span class="mw-arm">Tap again to confirm</span>');
        else {
            // "In progress" is no longer repeated per row -- the group heading
            // above already says it, and repeating it just crowded the line.
            if (r.late) cues.push('<span class="mw-late">Late</span>');
            if (r.projectName) cues.push(esc(r.projectName));
            if (r.kind === 'reminder') cues.push('Reminder');
        }
        const chip = r.projectName
            ? `<span class="mw-chip" style="background:var(--accent-${r.projectColor || 'blue'}-tint);color:var(--accent-${r.projectColor || 'blue'})">${esc(r.initial)}</span>`
            : '';
        return `<div class="mw-row${r.running ? ' running' : ''}">
            <button class="mw-check${r.armed ? ' armed' : ''}" data-id="${esc(r.id)}"
                    aria-label="${r.armed ? 'Confirm complete' : 'Mark done'}: ${esc(r.name)}"
                    title="${r.armed ? 'Tap again to confirm' : 'Mark done'}">${CHECK_SVG}</button>
            <span class="mw-body">
              <span class="mw-name">${chip}${esc(r.name)}</span>
              ${cues.length ? `<span class="mw-sub">${cues.join(' · ')}</span>` : ''}
            </span>
            <span class="mw-time">${esc(r.time || '')}</span>
        </div>`;
    }).join('');
}

// Resolve 'auto' to a CONCRETE light/dark in the main window, and stamp that
// literal value on the mini window.
//
// Confirmed live bug (2026-08-09): the main app was light, the mini window
// opened dark. Copying the raw data-theme value was the mistake -- theme.js
// stores 'auto' as a real value, and tokens.css resolves 'auto' through
// `@media (prefers-color-scheme: light)`. That media query is evaluated
// separately inside the picture-in-picture document, which does not reliably
// report the same preference as the page that opened it, so 'auto' could land
// on the opposite theme. Never pass 'auto' across the document boundary --
// decide it here, where the answer is known to be right, and send the answer.
function effectiveTheme() {
    const set = document.documentElement.getAttribute('data-theme') || 'auto';
    if (set === 'light' || set === 'dark') return set;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function renderMiniWindow() {
    if (!isMiniWindowOpen() || !host) return;
    pipWindow.document.documentElement.setAttribute('data-theme', effectiveTheme());
    renderRowsInto(pipWindow.document, host.miniWindowRows || []);
}

export async function openMiniWindow(page) {
    if (!isMiniWindowSupported()) {
        throw new Error('This browser cannot open a floating window. Chrome or Edge on desktop can.');
    }
    if (isMiniWindowOpen()) { pipWindow.focus(); return; }

    host = page;
    // Deliberately small: about four rows plus the header, measured against
    // the real row height (~40px bare, ~46px with a cue line). His explicit
    // ask was three or four rows visible with scrolling for the rest -- an
    // earlier 340px-tall version fitted seven, which is not "small". The
    // window never grows with the task count, same rule the Today card
    // already follows.
    pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 340,
        height: 240,
        disallowReturnToOpener: true
    });

    adoptStyles(pipWindow);
    pipWindow.document.body.innerHTML = MINI_SHELL_HTML;

    // One delegated listener, so re-rendering the list never leaves stale
    // handlers behind. Completion goes back to the page's own two-tap handler
    // -- the mini window deliberately owns no completion logic of its own, so
    // the confirm behaviour can never drift from the main app's.
    pipWindow.document.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.mw-check');
        if (!btn || !host) return;
        host.handleMiniComplete(btn.dataset.id);
    });

    // Follow the theme while the window is open -- both the app's own
    // switcher (theme.js dispatches this) and, when the app is on 'auto', a
    // change in the OS preference itself.
    const osScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const onThemeChange = () => renderMiniWindow();
    window.addEventListener('atlas-theme-changed', onThemeChange);
    osScheme.addEventListener('change', onThemeChange);

    // Fired when the user closes the mini window, and also when the browser
    // tears it down because Atlas itself was closed. Closing the mini window
    // deliberately does NOT close Atlas -- confirmed with Abhishek 2026-08-09.
    pipWindow.addEventListener('pagehide', () => {
        window.removeEventListener('atlas-theme-changed', onThemeChange);
        osScheme.removeEventListener('change', onThemeChange);
        const p = host;
        pipWindow = null;
        host = null;
        if (p && p.onMiniWindowClosed) p.onMiniWindowClosed();
    });

    renderMiniWindow();
}

export function closeMiniWindow() {
    if (isMiniWindowOpen()) pipWindow.close();
}
