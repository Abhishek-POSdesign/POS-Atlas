// Atlas AI -- Fact Package builder (Chapter 21 shape). Pure read-only: every
// function here only calls existing verified DB.* read methods (the exact
// same ones the dashboard already renders from) and never invents a new
// query path. No Finance/Learning Hub/BIS Research Hub data ever enters a
// package -- Atlas-only, per the module-independence rule.

import { DB } from '../db.js';
import { getLogicalDate, todayKey, todayIsoDate } from '../date-utils.js';

const SOURCE_VERSION = 'atlas-ai-v1';
const READ_LIMITS = [
    'Do not invent dates, times, scores, or durations not present in the facts',
    'Do not assume completion or state not present in the facts',
    'Only use the facts provided -- do not assume unstated context'
];

function basePackage(useCase, facts, allowedActions, privacyLevel) {
    return {
        domain: 'atlas',
        useCase,
        facts,
        limits: READ_LIMITS,
        allowedActions,
        privacyLevel: privacyLevel || 'local-only',
        sourceVersion: SOURCE_VERSION
    };
}

async function buildExplainDay() {
    const today = todayIsoDate();
    const checklistDate = todayKey();
    const dow = getLogicalDate().getDay();

    const [tasks, checklistItems, checklistHistory, streaks] = await Promise.all([
        DB.Tasks.listActive(),
        DB.Checklist.listItems(),
        DB.Checklist.listHistoryForDate(checklistDate),
        DB.Targets.listStreaks()
    ]);

    const upcoming = tasks.filter(t => t.status !== 'done' && (!t.scheduled_date || t.scheduled_date <= today));
    const overdue = upcoming.filter(t => t.scheduled_date && t.scheduled_date < today);
    const doneToday = tasks.filter(t => t.status === 'done' && t.completed_at && t.completed_at.slice(0, 10) === today);

    const todaysItems = checklistItems.filter(i => !i.days || i.days.includes(dow));
    const doneIds = new Set(checklistHistory.filter(h => h.status === 'done').map(h => h.item_id));
    const skippedIds = new Set(checklistHistory.filter(h => h.status === 'skipped').map(h => h.item_id));

    const taskList = upcoming.slice(0, 20).map(t => {
        const bucket = !t.scheduled_date ? 'no date' : t.scheduled_date < today ? 'overdue' : t.scheduled_date === today ? 'due today' : 'future-dated';
        return `${t.name} [${t.kind || 'task'}; ${bucket}; priority: ${t.priority || 'normal'}; status: ${t.status}${t.running_note ? '; note: ' + t.running_note : ''}]`;
    });

    return basePackage('explain_day', {
        currentDate: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
        taskSituation: `${overdue.length} carried/overdue, ${upcoming.length - overdue.length} due today or undated, ${doneToday.length} completed today.`,
        pendingTasks: taskList,
        checklistToday: `${todaysItems.filter(i => doneIds.has(i.id)).length} of ${todaysItems.length} routine items done, ${todaysItems.filter(i => skippedIds.has(i.id)).length} skipped.`,
        streaks: streaks.map(s => {
            const days = Math.max(0, Math.floor((new Date(todayKey()) - new Date(s.streak_start_date)) / 86400000));
            return `${s.name}: ${days} days`;
        })
    }, ['explain', 'suggest']);
}

async function buildExplainTask(taskId) {
    const tasks = await DB.Tasks.listActive();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return basePackage('explain_task', { error: 'task not found' }, ['explain']);

    let recentLogs = [];
    if (task.project_id) {
        try {
            const logs = await DB.TaskLogs.listForProject(task.project_id);
            recentLogs = logs.filter(l => l.task_id === taskId).slice(0, 5).map(l => l.body);
        } catch (e) { /* project may have no logs yet */ }
    }

    return basePackage('explain_task', {
        currentDate: todayIsoDate(),
        taskName: task.name,
        kind: task.kind,
        status: task.status,
        priority: task.priority || 'normal',
        scheduledDate: task.scheduled_date || 'none',
        scheduledTime: task.scheduled_time || 'none',
        runningNote: task.running_note || 'none',
        recentLogEntries: recentLogs
    }, ['explain', 'suggest']);
}

async function buildExplainHealth() {
    const [sleepLogs, workoutLogs, streaks] = await Promise.all([
        DB.Sleep.listRecent(14),
        DB.Workout.listRecent(14),
        DB.Targets.listStreaks()
    ]);

    return basePackage('explain_health', {
        currentDate: todayIsoDate(),
        recentSleep: sleepLogs.map(s => `${s.entry_date}: ${s.duration_minutes != null ? Math.floor(s.duration_minutes / 60) + 'h ' + (s.duration_minutes % 60) + 'm' : 'no duration'}${s.sleep_score != null ? ', score ' + s.sleep_score : ''}`),
        recentWorkouts: workoutLogs.map(w => `${w.entry_date}: ${w.day_type || 'unspecified'}${w.workout_score != null ? ', score ' + w.workout_score : ''}`),
        streaks: streaks.map(s => s.name)
    }, ['explain', 'suggest']);
}

// ---- write-flow packages: minimal context so Atlas can phrase a natural
// rephrase-back. The actual field extraction happens via the model's JSON
// response (see WRITE_FLOWS below), never invented by this builder. ----
async function buildLogWorkout() {
    const today = todayIsoDate();
    const existing = await DB.Workout.getByDate(today);
    return basePackage('log_workout', {
        today,
        alreadyLoggedToday: !!existing
    }, ['propose_write']);
}
async function buildLogSleep() {
    const today = todayIsoDate();
    const existing = await DB.Sleep.getByDate(today);
    return basePackage('log_sleep', {
        today,
        alreadyLoggedToday: !!existing
    }, ['propose_write']);
}

export async function buildFactPackage(useCase, entityId) {
    switch (useCase) {
        case 'explain_day': return buildExplainDay();
        case 'explain_task': return buildExplainTask(entityId);
        case 'explain_health': return buildExplainHealth();
        case 'log_workout': return buildLogWorkout();
        case 'log_sleep': return buildLogSleep();
        default: return buildExplainDay();
    }
}

// ---- Write flows: Phase 1 ships exactly two (log workout, log sleep).
// Each carries a narrow extraction instruction telling the model exactly
// what JSON shape to reply with when it recognizes that intent in the
// user's message -- otherwise it replies normally in prose. The app never
// trusts the model's fields blindly: every value is re-validated/clamped
// against these `fields` definitions before it's shown in the confirm card
// or written to the database. ----
export const WRITE_FLOWS = {
    log_workout: {
        title: 'Draft · Log workout',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 4v16M18 4v16M4 8h4M4 16h4M16 8h4M16 16h4"/></svg>',
        fields: [
            { key: 'score', label: 'Score', type: 'number', min: 0, max: 10 },
            { key: 'calories', label: 'Calories', type: 'number', min: 0, max: 3000 },
            { key: 'duration_minutes', label: 'Duration (min)', type: 'number', min: 0, max: 600 },
            { key: 'note', label: 'Note', type: 'text' }
        ],
        extractionInstruction: 'If Abhishek describes completing a workout (mentions a score, calories, duration, or simply "did my workout"), respond ONLY with a JSON object, no other text: {"intent":"log_workout","fields":{"score":number|null,"calories":number|null,"duration_minutes":number|null,"note":string|null}}. Use null for any field not mentioned. Do not invent numbers.',
        async write(fields) {
            const today = todayIsoDate();
            const patch = {};
            if (fields.score != null) patch.workout_score = fields.score;
            if (fields.calories != null) patch.calories = fields.calories;
            if (fields.duration_minutes != null) patch.duration_minutes = fields.duration_minutes;
            if (fields.note) patch.note = fields.note;
            patch.day_type = 'workout';
            return DB.Workout.save(today, patch);
        }
    },
    log_sleep: {
        title: 'Draft · Log sleep',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
        fields: [
            { key: 'duration_minutes', label: 'Duration (min)', type: 'number', min: 0, max: 1440 },
            { key: 'sleep_score', label: 'Score', type: 'number', min: 0, max: 100 },
            { key: 'morning_note', label: 'Morning reflection', type: 'text' }
        ],
        extractionInstruction: 'If Abhishek describes last night\'s sleep (a duration like "6 hours" or "6 and a half hours", a score, or how he feels this morning), respond ONLY with a JSON object, no other text: {"intent":"log_sleep","fields":{"duration_minutes":number|null,"sleep_score":number|null,"morning_note":string|null}}. Convert spoken durations to total minutes (e.g. "6 and a half hours" = 390). Use null for any field not mentioned. Do not invent numbers.',
        async write(fields) {
            const today = todayIsoDate();
            const patch = {};
            if (fields.duration_minutes != null) patch.duration_minutes = fields.duration_minutes;
            if (fields.sleep_score != null) patch.sleep_score = fields.sleep_score;
            if (fields.morning_note) patch.morning_note = fields.morning_note;
            return DB.Sleep.save(today, patch);
        }
    }
};

// Validates+clamps a model-produced fields object against a flow's field
// defs. Unknown keys are dropped; out-of-range numbers are clamped rather
// than trusted; non-numeric values on a number field become null (never a
// silent wrong write -- the confirm card just won't show that field).
export function sanitizeDraftFields(flowKey, rawFields) {
    const flow = WRITE_FLOWS[flowKey];
    if (!flow || !rawFields) return null;
    const out = {};
    for (const f of flow.fields) {
        let v = rawFields[f.key];
        if (v === undefined || v === null) continue;
        if (f.type === 'number') {
            const n = Number(v);
            if (isNaN(n)) continue;
            out[f.key] = Math.min(f.max, Math.max(f.min, n));
        } else {
            const s = String(v).trim();
            if (s) out[f.key] = s;
        }
    }
    return out;
}
