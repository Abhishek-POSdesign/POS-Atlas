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

    const pkg = basePackage('explain_day', {
        currentDate: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
        taskSituation: `${overdue.length} carried/overdue, ${upcoming.length - overdue.length} due today or undated, ${doneToday.length} completed today.`,
        pendingTasks: taskList,
        checklistToday: `${todaysItems.filter(i => doneIds.has(i.id)).length} of ${todaysItems.length} routine items done, ${todaysItems.filter(i => skippedIds.has(i.id)).length} skipped.`,
        streaks: streaks.map(s => {
            const days = Math.max(0, Math.floor((new Date(todayKey()) - new Date(s.streak_start_date)) / 86400000));
            return `${s.name}: ${days} days`;
        })
    }, ['explain', 'suggest']);
    // Private arrays for client-side resolution -- NOT in pkg.facts, never sent to model
    pkg._taskList = upcoming.slice(0, 20);
    pkg._checklistItems = todaysItems;
    pkg._checklistDate = checklistDate;
    return pkg;
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
            { key: 'score', label: 'Score (0-100)', type: 'number', min: 0, max: 100 },
            { key: 'calories', label: 'Calories', type: 'number', min: 0, max: 5000 },
            { key: 'duration_minutes', label: 'Duration (min)', type: 'number', min: 0, max: 600 },
            { key: 'vo2_max', label: 'VO2 Max', type: 'number', min: 0, max: 100 },
            { key: 'workout_type', label: 'Workout type', type: 'text' },
            { key: 'note', label: 'Note', type: 'text' }
        ],
        extractionInstruction: 'When the message describes a completed workout (mentions a score, calories, duration, VO2 max, workout type, or having done a workout session), extract these fields and return exactly this JSON:\n{"intent":"log_workout","fields":{"score":number|null,"calories":number|null,"duration_minutes":number|null,"vo2_max":number|null,"workout_type":string|null,"note":string|null}}\nField semantics: score = 0-100 (Garmin/fitness scale). vo2_max = VO2 max decimal like 48.8. workout_type = category e.g. "strength", "cardio", "yoga", "hiit". duration_minutes = total workout duration in minutes. note = qualitative details that do not fit any other field. Map each data point to the correct field -- do NOT cram workout_type or vo2_max into note. Use null for any field not mentioned. Do not invent values.\nIf the message does not describe a completed workout, return {"intent":null}.',
        async write(fields) {
            const today = todayIsoDate();
            const patch = {};
            if (fields.score != null) patch.workout_score = fields.score;
            if (fields.calories != null) patch.calories = fields.calories;
            if (fields.duration_minutes != null) patch.duration_minutes = fields.duration_minutes;
            if (fields.vo2_max != null) patch.vo2_max = fields.vo2_max;
            if (fields.workout_type) patch.workout_type = fields.workout_type;
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
            { key: 'sleep_score', label: 'Score (0-100)', type: 'number', min: 0, max: 100 },
            { key: 'deep_minutes', label: 'Deep sleep (min)', type: 'number', min: 0, max: 720 },
            { key: 'rem_minutes', label: 'REM sleep (min)', type: 'number', min: 0, max: 720 },
            { key: 'resting_hr', label: 'Resting HR (bpm)', type: 'number', min: 20, max: 200 },
            { key: 'hrv', label: 'HRV (ms)', type: 'number', min: 0, max: 300 },
            { key: 'morning_note', label: 'Morning reflection', type: 'text' }
        ],
        extractionInstruction: 'When the message describes last night\'s sleep, extract these fields and return exactly this JSON:\n{"intent":"log_sleep","fields":{"duration_minutes":number|null,"sleep_score":number|null,"deep_minutes":number|null,"rem_minutes":number|null,"resting_hr":number|null,"hrv":number|null,"morning_note":string|null}}\nField semantics: duration_minutes = total sleep in minutes (convert hours, e.g. "8 hours" = 480). sleep_score = score or quality rating 0-100. deep_minutes = deep sleep duration. rem_minutes = REM sleep duration. resting_hr = resting heart rate in bpm. hrv = HRV in ms. morning_note = how he feels or any qualitative comment. Map each data point to the correct field -- do NOT dump multiple values into morning_note. Use null for any field not mentioned. Do not invent values.\nIf the message does not describe sleep, return {"intent":null}.',
        async write(fields) {
            const today = todayIsoDate();
            const patch = {};
            if (fields.duration_minutes != null) patch.duration_minutes = fields.duration_minutes;
            if (fields.sleep_score != null) patch.sleep_score = fields.sleep_score;
            if (fields.deep_minutes != null) patch.deep_minutes = fields.deep_minutes;
            if (fields.rem_minutes != null) patch.rem_minutes = fields.rem_minutes;
            if (fields.resting_hr != null) patch.resting_hr = fields.resting_hr;
            if (fields.hrv != null) patch.hrv = fields.hrv;
            if (fields.morning_note) patch.morning_note = fields.morning_note;
            return DB.Sleep.save(today, patch);
        }
    },
    complete_task: {
        title: 'Draft · Complete task',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        fields: [
            { key: 'task_name', label: 'Task', type: 'text' }
        ],
        // Dynamic context (numbered task list) is prepended by _extractFields() before this string
        extractionInstruction: 'When the message says a specific task is done, finished, or completed, extract these fields and return exactly this JSON:\n{"intent":"complete_task","fields":{"task_number":number|null,"task_name":string|null}}\nField semantics: task_number = 1-based number from the task list above (use when he says "task 4", "number 3", "#2", etc.). task_name = exact task name verbatim if he named the task -- do not paraphrase. Set one field; set the other to null.\nIf the message does not mention completing a task from the list, or is ambiguous about which task, return {"intent":null}.',
        async write(fields) {
            if (!fields.task_id) throw new Error('Task not identified -- confirm card should have supplied the ID');
            return DB.Tasks.complete(fields.task_id, null);
        }
    },
    mark_checklist: {
        title: 'Draft · Mark routine items',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><polyline points="4 6 5 7 7 5"/><polyline points="4 12 5 13 7 11"/><polyline points="4 18 5 19 7 17"/></svg>',
        fields: [], // confirm card built manually in _handleChecklistMarking(), not via sanitizeDraftFields
        // Dynamic context (today's checklist grouped by block) is prepended by _extractFields() before this string
        extractionInstruction: 'When the message says specific routine or checklist items were done or skipped, extract them and return exactly this JSON:\n{"intent":"mark_checklist","fields":{"items":[{"block":"morning|afternoon|night|sleep","number":1,"name":"exact item name or null if using number","status":"done or skipped","note":"optional note or null"}]}}\nResolution priority: use block+number when he says "morning 2 and 3" or "afternoon 1". Use exact name when he names the item. "number" is the 1-based position within its block from the list above; if no block is named, use flat position across all items. "note" captures extra detail about a specific item (e.g. "used a new brand"). Only include items he explicitly mentioned. "status" is "done" or "skipped".\nIf the message does not mention routine or checklist items, return {"intent":null}.',
        async write(fields) {
            if (!fields.resolved || !fields.resolved.length) throw new Error('No items to mark');
            for (const item of fields.resolved) {
                const extra = {};
                if (item.note) extra.note = item.note;
                await DB.Checklist.setStatus(item.id, fields.date, item.status, extra);
            }
        }
    },
    save_ai_memory: {
        title: 'Draft · Save to AI Memory',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
        fields: [
            { key: 'summary', label: 'Memory note', type: 'text' }
        ],
        // save_ai_memory is handled client-side via Track A in aiPanel.js sendMessage()
        // (no model call -- immediate confirm card from user's own text).
        // This extractionInstruction is never used; write() is unreachable.
        extractionInstruction: '',
        async write(fields) {
            // Track A in sendMessage() bypasses this -- confirmDraft() handles save_ai_memory directly
        }
    },
    journal_reflection: {
        title: 'Draft · Daily journal',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
        fields: [
            { key: 'body', label: 'Reflection', type: 'text' }
        ],
        extractionInstruction: 'When the message shares a personal feeling, reflection, emotion, or describes what today was like (gratitude, frustration, pride, a realisation, a mood), extract and return exactly this JSON:\n{"intent":"journal_reflection","fields":{"body":"his reflection in his own words, preserving the emotional tone"}}\nOnly trigger for genuine reflective or emotional content -- not for task/health questions, greetings, or factual questions.\nIf the message is not a personal reflection, return {"intent":null}.',
        async write(fields) {
            if (!fields.body) throw new Error('No reflection text');
            const today = todayIsoDate();
            const existing = await DB.Notebook.getByDate(today);
            if (existing) {
                return DB.Notebook.update(existing.id, { body: existing.body + '\n\n' + fields.body });
            }
            return DB.Notebook.create({ entry_date: today, body: fields.body });
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
