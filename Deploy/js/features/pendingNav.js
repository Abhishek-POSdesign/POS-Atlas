// Tiny cross-page handoff for "navigate to a page, then open a specific
// item there" -- used by the Calendar's Tasks & Reminders drill-down so it
// reuses Today's / the Project workspace's own real task edit modal instead
// of building a third duplicate of it. Module-scoped (not window.*), consumed
// once by whichever page's init()/open() runs next after being set.
let _pendingTask = null;

export function setPendingTask(task) { _pendingTask = task; }

export function consumePendingTask() {
    const t = _pendingTask;
    _pendingTask = null;
    return t;
}
