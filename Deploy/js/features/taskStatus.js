// Single, shared definition of "is this task/reminder overdue" -- the one
// place this gets decided, so Today and the Project workspace (or any
// future page) can never independently drift apart on what overdue means.
//
// Confirmed live bug (2026-07-31 correction round 2): Today used to keep
// its own private copy of this check, and that private copy never fully
// respected the task's real status -- it excluded 'done', later 'in_progress',
// but never 'paused', so a paused task with a past date still read as
// overdue. A running or paused task is never overdue -- overdue only means
// something for work that hasn't been picked up yet.
import { todayIsoDate } from '../date-utils.js';

export function isOverdue(task) {
    if (!task) return false;
    if (task.status === 'done' || task.status === 'in_progress' || task.status === 'paused') return false;
    if (!task.scheduled_date) return false;
    const today = todayIsoDate();
    if (task.scheduled_date < today) return true;
    if (task.scheduled_date === today && task.scheduled_time) {
        const now = new Date();
        const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        return task.scheduled_time.slice(0, 5) < hhmm;
    }
    return false;
}
