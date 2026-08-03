// Shared 6 AM logical-day boundary, used by the Checklist (and anything else
// that needs "today" to keep running until 6am for a night-shift schedule).
// Mirrors the sibling Task Manager app's core/utils.js getLogicalDate/todayKey
// exactly -- that boundary is hard-won there (see its CLAUDE.md rule #4) and
// the same reasoning applies here: Abhishek marks his last checklist items
// before sleep, sometimes after midnight, and the day shouldn't roll over
// under him mid-routine.

export function getLogicalDate(d = new Date()) {
    const ld = new Date(d);
    ld.setHours(ld.getHours() - 6);
    return ld;
}

export function todayKey() {
    return getLogicalDate().toLocaleDateString('en-CA');
}

// Midnight calendar date -- the ISO YYYY-MM-DD of the current wall clock,
// with no 6am shift. This is what everything except checklist/streak history
// should key on (tasks, projects, work log, notebook entries, daily journal,
// sleep, workout). Locked in CLAUDE.md 2026-07-26; a regression that pointed
// notebook + daily-journal at todayKey() (6am shift) silently misfiled any
// entry made between midnight and 6am, so both callers now use this helper
// instead of duplicating their own local copies.
export function todayIsoDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Converts a UTC timestamp string (like "2026-08-04T02:11:00.000Z") to a local
// calendar date string (like "2026-08-04"). Used to ensure that tasks completed
// locally on August 4th are displayed as completed on August 4th, even if the
// UTC timestamp was still August 3rd.
export function toLocalIsoDate(timestampString) {
    if (!timestampString) return '';
    const d = new Date(timestampString);
    if (isNaN(d.getTime())) return timestampString.slice(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
