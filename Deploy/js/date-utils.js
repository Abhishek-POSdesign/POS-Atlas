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
