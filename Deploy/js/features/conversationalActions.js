// Atlas AI -- Conversational Actions (voice-first logging & creation).
// Approved plan: PLAN.md's "NEXT UP" section (2026-08-07), locked rules in
// CLAUDE.md's "AI Conversational Actions" section. Read both before editing.
//
// This file is the one reusable mechanism every "log X" / "create Y" AI
// write flow plugs into -- a running draft that survives across turns, a
// deterministic (plain-JS, not model) check for which field to ask about
// next, one question at a time, explicit-skip handling, and a final
// read-back that requires an explicit yes before anything is written.
// Adding a new action means adding an entry to CONVERSATIONAL_ACTIONS, not
// writing a new bespoke flow -- if that stops being true, the mechanism has
// drifted from its intended shape.
//
// This module is pure logic -- no model calls, no DOM, no Alpine. The model
// is only ever used (from aiPanel.js) for one narrow job: pulling field
// values out of a sentence. Whether a field is still missing, what to ask
// next, and whether the user said yes/no/skip/cancel are all decided here,
// deterministically, so the feature stays reliable even when the model
// answering it is swapped (Ollama <-> Gemini) or briefly unavailable.

import { DB } from '../db.js';
import { WRITE_FLOWS } from './aiContext.js';

// ---- Field value helpers ----

function clampField(fieldDef, rawValue) {
    if (rawValue === undefined || rawValue === null) return null;
    if (fieldDef.type === 'number') {
        const n = Number(rawValue);
        if (isNaN(n)) return null;
        return Math.min(fieldDef.max, Math.max(fieldDef.min, n));
    }
    if (fieldDef.type === 'enum') {
        const s = String(rawValue).trim().toLowerCase();
        return fieldDef.options.includes(s) ? s : null;
    }
    const s = String(rawValue).trim();
    return s ? s.slice(0, 300) : null;
}

function formatFieldValue(fieldDef, value) {
    if (fieldDef.type === 'number') return `${value}${fieldDef.unit ? ' ' + fieldDef.unit : ''}`;
    if (fieldDef.type === 'enum') return value.charAt(0).toUpperCase() + value.slice(1);
    return String(value);
}

// Deterministic classifier from free-text workout description to the fixed
// activity_type enum atlas_workout_sessions actually uses (see CLAUDE.md's
// "activity_type CHECK constraint" note). The day-level workout_type field
// stays free text (richer, e.g. "leg day") -- this only derives the
// constrained session-level type so a real session row can be created,
// mirroring exactly what the manual "Log workout" form writes.
function classifyActivityType(text) {
    const t = (text || '').toLowerCase();
    if (/yoga|stretch/.test(t)) return 'yoga_stretch';
    if (/clean/.test(t)) return 'cleaning';
    if (/\bplay\b|sport|badminton|football|basketball|tennis/.test(t)) return 'active_play';
    if (/run|jog|walk|cardio|cycl|swim|bike/.test(t)) return 'cardio_walk';
    return 'strength'; // strength/weights/lifting/gym/hiit/legs/upper/lower default
}

// ---- Action registry ----
// Each field: key, label (for read-back/confirm card), type, min/max (numbers),
// unit (for read-back phrasing), ask (true = actively ask if unmentioned;
// false = fine to silently leave blank), required (true = cannot be skipped,
// re-asks until answered), extractHint (a short phrase describing the field
// for the extraction model call), question (what Atlas asks aloud/in text).
//
// CLAUDE.md's locked rule: "never silently drop an unmentioned field
// without asking." Every field below is real user data, so every one of
// them is ask:true -- confirmed live 2026-08-07 that deep/REM sleep going
// unasked read as a bug, not a convenience, even though PLAN.md's original
// spec described an ask:false tier as sanctioned. ask:false stays available
// in the engine for a genuinely internal/non-data field if one ever shows
// up, but no current field qualifies -- don't add one back without a real
// reason, and if you do, it should be the rare exception, not the default.

export const CONVERSATIONAL_ACTIONS = {
    log_sleep: {
        label: 'sleep log',
        cardTitle: 'Draft · Log sleep',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
        // Superset of the old single-shot _detectIntent() sleep regex --
        // reused verbatim so nothing that used to start a sleep log stops
        // starting one now that the trigger moved into this engine.
        startPattern: /\b(sle(ep|pt)|nap(ped)?|sleep\s*score|deep\s*sleep|rem\b|resting\s*(heart\s*rate|hr)|hrv|heart\s*rate\s*variability|woke\s*up|bed\s*time|hours?\s+(of\s+)?sleep|fell\s+asleep|night\s+was|slept\s+(well|poorly|badly|great))\b/,
        fields: [
            { key: 'duration_minutes', label: 'Duration', type: 'number', min: 0, max: 1440, unit: 'min', ask: true, required: false, extractHint: 'total sleep duration in minutes (convert "8 hours" to 480)', question: "How long did you sleep, roughly?" },
            { key: 'sleep_score', label: 'Score', type: 'number', min: 0, max: 100, ask: true, required: false, extractHint: 'sleep score or quality rating, 0-100', question: "What was your sleep score?" },
            { key: 'hrv', label: 'HRV', type: 'number', min: 0, max: 300, unit: 'ms', ask: true, required: false, extractHint: 'HRV in milliseconds', question: "Do you have an HRV reading, or should I leave that blank?" },
            { key: 'resting_hr', label: 'Resting HR', type: 'number', min: 20, max: 200, unit: 'bpm', ask: true, required: false, extractHint: 'resting heart rate in bpm', question: "What was your resting heart rate?" },
            { key: 'deep_minutes', label: 'Deep sleep', type: 'number', min: 0, max: 720, unit: 'min', ask: true, required: false, extractHint: 'deep sleep duration in minutes', question: "Got a deep sleep number, or should I skip it?" },
            { key: 'rem_minutes', label: 'REM sleep', type: 'number', min: 0, max: 720, unit: 'min', ask: true, required: false, extractHint: 'REM sleep duration in minutes', question: "And REM sleep -- any number for that?" },
            { key: 'morning_note', label: 'Note', type: 'text', ask: true, required: false, extractHint: 'how he feels or any qualitative comment', question: "Anything else you want to note about last night?" }
        ],
        write(fields) { return WRITE_FLOWS.log_sleep.write(fields); }
    },
    log_workout: {
        label: 'workout log',
        cardTitle: 'Draft · Log workout',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 4v16M18 4v16M4 8h4M4 16h4M16 8h4M16 16h4"/></svg>',
        startPattern: /\b(workout|exercise|training|cardio|strength|calories|gym|leg\s*day|push\s*day|pull\s*day|run(ning)?|jog(ging)?|swim(ming)?|cycling|lift(ing)?|weights?|squats?|deadlifts?|bench|hiit|yoga|burned|reps|sets|treadmill|session|went\s+to\s+(the\s+)?gym|personal\s+record|PR\b|vo2)\b/,
        fields: [
            { key: 'workout_type', label: 'Type', type: 'text', ask: true, required: false, extractHint: 'category e.g. "strength", "cardio", "yoga", "hiit"', question: "What kind of workout was it?" },
            { key: 'duration_minutes', label: 'Duration', type: 'number', min: 0, max: 600, unit: 'min', ask: true, required: false, extractHint: 'total workout duration in minutes', question: "How long did it run?" },
            { key: 'score', label: 'Score', type: 'number', min: 0, max: 100, ask: true, required: false, extractHint: 'workout score, 0-100 fitness-scale', question: "Any workout score for this one?" },
            { key: 'calories', label: 'Calories', type: 'number', min: 0, max: 5000, ask: true, required: false, extractHint: 'calories burned', question: "How many calories did it log?" },
            { key: 'vo2_max', label: 'VO2 Max', type: 'number', min: 0, max: 100, ask: true, required: false, extractHint: 'VO2 max decimal like 48.8', question: "Do you have a VO2 max reading for this one?" },
            { key: 'intensity', label: 'Intensity', type: 'enum', options: ['light', 'moderate', 'hard'], ask: true, required: false, extractHint: 'workout intensity -- exactly one of "light", "moderate", or "hard"', question: "How intense was it -- light, moderate, or hard?" },
            { key: 'note', label: 'Note', type: 'text', ask: true, required: false, extractHint: 'qualitative details that do not fit any other field', question: "Anything else worth noting about the workout?" }
        ],
        // Mirrors the manual "Log workout" flow exactly: a day-level summary
        // row (atlas_workout_logs -- score/calories/vo2/duration/free-text
        // type/note) PLUS a linked session row (atlas_workout_sessions --
        // constrained activity_type/duration/intensity). Added 2026-08-08:
        // writing only the day-level row left the Today page's workout card
        // with nothing to show beyond duration+type, because its score/
        // calories/vo2 chips only render once a real session row exists
        // (see index.html's "idx === 0 && workoutEntry..." check) -- that's
        // not a display bug, it's this write path being incomplete.
        async write(fields) {
            const dayRow = await WRITE_FLOWS.log_workout.write(fields);
            const activityType = classifyActivityType(fields.workout_type);
            await DB.WorkoutSessions.create(dayRow.id, {
                activity_type: activityType,
                duration_minutes: fields.duration_minutes != null ? fields.duration_minutes : null,
                intensity: activityType === 'strength' ? (fields.intensity || null) : null,
                program_tag: null,
                note: null
            });
            return dayRow;
        }
    },
    create_task: {
        label: 'task',
        cardTitle: 'Draft · Create task',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
        startPattern: /\b((add|create|make|new)\s+(a\s+)?task\b|\btask\s*:|\bi\s+need\s+to\s+(add|create)\s+a\s+task)\b/,
        fields: [
            { key: 'name', label: 'Name', type: 'text', ask: true, required: true, extractHint: 'the task name/title, verbatim', question: "What should the task be called?" },
            { key: 'project', label: 'Project', type: 'text', ask: true, required: false, extractHint: 'the project name it belongs to, if he names one', question: "Which project is this for, or should it stand alone?" },
            { key: 'scheduled_date', label: 'Date', type: 'date', ask: true, required: false, extractHint: 'the date it\'s scheduled for, resolved to YYYY-MM-DD (today/tomorrow/a weekday name all count)', question: "What date is it for? You can say \"today\", \"tomorrow\", or a date." },
            { key: 'scheduled_time', label: 'Time', type: 'time', ask: true, required: false, extractHint: 'the time of day, resolved to 24-hour HH:MM', question: "Does it need a specific time, or just the date?" },
            { key: 'running_note', label: 'Note', type: 'text', ask: true, required: false, extractHint: 'any extra detail about the task', question: "Any notes to attach to it?" }
        ],
        async write(fields) {
            const { projectId, matched } = await resolveProjectId(fields.project);
            const row = {
                name: fields.name,
                kind: 'task',
                project_id: projectId,
                scheduled_date: fields.scheduled_date || null,
                scheduled_time: fields.scheduled_time || null,
                notify_enabled: false,
                priority: 'normal',
                status: 'not_started'
            };
            if (fields.running_note) row.running_note = fields.running_note;
            const created = await DB.Tasks.create(row);
            created._projectRequestedButUnmatched = !!fields.project && !matched;
            return created;
        }
    },
    create_reminder: {
        label: 'reminder',
        cardTitle: 'Draft · Create reminder',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
        startPattern: /\b((add|create|set|new)\s+(a\s+)?remind(er)?\b|\bremind\s+me\b)/,
        fields: [
            { key: 'name', label: 'Name', type: 'text', ask: true, required: true, extractHint: 'what the reminder is for, verbatim', question: "What should I remind you about?" },
            { key: 'project', label: 'Project', type: 'text', ask: true, required: false, extractHint: 'the project name it belongs to, if he names one', question: "Which project is this for, or should it stand alone?" },
            { key: 'scheduled_date', label: 'Date', type: 'date', ask: true, required: false, extractHint: 'the date it\'s for, resolved to YYYY-MM-DD (today/tomorrow/a weekday name all count)', question: "What date?" },
            { key: 'scheduled_time', label: 'Time', type: 'time', ask: true, required: false, extractHint: 'the time of day, resolved to 24-hour HH:MM', question: "What time should it fire?" },
            { key: 'running_note', label: 'Note', type: 'text', ask: true, required: false, extractHint: 'any extra detail', question: "Any notes to attach to it?" }
        ],
        async write(fields) {
            const { projectId, matched } = await resolveProjectId(fields.project);
            const row = {
                name: fields.name,
                kind: 'reminder',
                project_id: projectId,
                scheduled_date: fields.scheduled_date || null,
                scheduled_time: fields.scheduled_time || null,
                notify_enabled: true,
                priority: 'normal',
                status: 'not_started'
            };
            if (fields.running_note) row.running_note = fields.running_note;
            const created = await DB.Tasks.create(row);
            created._projectRequestedButUnmatched = !!fields.project && !matched;
            return created;
        }
    }
};

// Resolves a spoken/typed project name against the real, currently-running
// project list. Exact match first, then a one-directional substring match
// (handles "Atlas" matching "POS_Atlas Development") only when it's
// unambiguous. Never blocks the save on a miss -- a task/reminder that
// named a project it couldn't match still gets created, just standalone;
// the caller (aiPanel.js) tells the user that happened via
// `_projectRequestedButUnmatched` rather than silently dropping the intent.
async function resolveProjectId(nameGuess) {
    if (!nameGuess) return { projectId: null, matched: true };
    const projects = await DB.Projects.listActive();
    const needle = nameGuess.trim().toLowerCase();
    const exact = projects.filter(p => p.name.toLowerCase() === needle);
    if (exact.length === 1) return { projectId: exact[0].id, matched: true };
    const partial = projects.filter(p => p.name.toLowerCase().includes(needle) || needle.includes(p.name.toLowerCase()));
    if (partial.length === 1) return { projectId: partial[0].id, matched: true };
    return { projectId: null, matched: false };
}

// ---- Trigger detection ----
// Deterministic -- no model call. Returns { action } on a clean single
// match, { ambiguous: [keys] } when more than one action's pattern matches
// (so the caller can ask which one instead of guessing), or null.
export function detectActionStart(text) {
    const matches = Object.keys(CONVERSATIONAL_ACTIONS).filter(k => CONVERSATIONAL_ACTIONS[k].startPattern.test(text));
    if (matches.length === 0) return null;
    if (matches.length === 1) return { action: matches[0] };
    return { ambiguous: matches };
}

// Resolves a disambiguation follow-up ("sleep" / "the workout one") against
// a shortlist of candidate action keys. Returns a key or null if still unclear.
export function resolveAmbiguous(text, candidates) {
    const hits = candidates.filter(k => CONVERSATIONAL_ACTIONS[k].startPattern.test(text));
    if (hits.length === 1) return hits[0];
    // Fall back to loose label matching ("the reminder" / "task")
    const t = text.toLowerCase();
    const byLabel = candidates.filter(k => t.includes(CONVERSATIONAL_ACTIONS[k].label.split(' ')[0]));
    if (byLabel.length === 1) return byLabel[0];
    return null;
}

// ---- Draft lifecycle ----

export function newDraft(actionKey) {
    const action = CONVERSATIONAL_ACTIONS[actionKey];
    const fields = {};
    for (const f of action.fields) fields[f.key] = { value: null, skipped: false };
    return { action: actionKey, fields, awaitingField: null, awaitingConfirm: false };
}

export function draftHasAnyValue(draft) {
    return Object.values(draft.fields).some(f => f.value !== null);
}

// Applies model-extracted values onto a draft. Only touches fields present
// (non-null) in `extracted`; never overwrites a field the user already
// explicitly skipped unless the new message re-supplies a real value.
export function mergeExtractedFields(draft, extracted) {
    if (!extracted) return;
    const action = CONVERSATIONAL_ACTIONS[draft.action];
    for (const f of action.fields) {
        const raw = extracted[f.key];
        if (raw === undefined || raw === null) continue;
        const clamped = clampField(f, raw);
        if (clamped === null) continue;
        draft.fields[f.key] = { value: clamped, skipped: false };
    }
}

// Next field worth actively asking about, or null once every ask-worthy
// field is either filled or (for non-required fields) explicitly skipped.
export function firstMissingField(draft) {
    const action = CONVERSATIONAL_ACTIONS[draft.action];
    for (const f of action.fields) {
        if (!f.ask) continue;
        const state = draft.fields[f.key];
        if (state.value !== null) continue;
        if (state.skipped && !f.required) continue;
        return f;
    }
    return null;
}

// A field is ONLY ever skipped by the user's own literal decline answer to
// the specific question asked about it (see isDeclineAnswer() below, called
// from aiPanel.js's _continueConversationalAction()) -- there used to also be
// a model-reported "declined" list here that could mark a field skipped on
// the model's own judgment. Removed 2026-08-08: it was a real bug (confirmed
// live -- REM sleep and a closing note both went unasked despite being
// ask:true) and a direct violation of the "model never decides what happens
// next" rule this whole engine is built on. Don't bring it back.
export function markSkipped(draft, fieldKey) {
    draft.fields[fieldKey] = { value: null, skipped: true };
}

// ---- Deterministic phrase detectors ----
// These exist so the safety-critical parts of the loop (cancel, decline,
// final yes/no) never depend on a model call succeeding.

export function isCancelPhrase(text) {
    return /^\s*(cancel|never\s*mind|stop\s+this|forget\s+it|abort|start\s+over)\b/i.test(text.trim());
}

// Only treated as a decline when the reply has no digits -- "no, wait it's
// 8" should still reach the extraction call, not get swallowed as a skip.
export function isDeclineAnswer(text) {
    const t = text.trim();
    if (/\d/.test(t)) return false;
    return /^\s*(no|nope|nah|n\/a|na|none|don'?t\s+have|dont\s+have|not\s+sure|skip(\s+it)?|i\s+don'?t\s+know|idk|leave\s+it\s+blank)\b/i.test(t);
}

export function isYes(text) {
    return /\b(yes|yeah|yep|yup|confirm(ed)?|correct|save\s+it|go\s+ahead|do\s+it|that'?s\s+right|sounds?\s+good|looks?\s+good)\b/i.test(text);
}

export function isNo(text) {
    return /\b(no|nope|nah|cancel|stop|wait|hold\s+on|don'?t\s+save|not\s+yet|that'?s\s+wrong|change\s+something)\b/i.test(text);
}

// ---- Read-back ----

export function formatReadBack(draft) {
    const action = CONVERSATIONAL_ACTIONS[draft.action];
    const filled = [];
    const blank = [];
    for (const f of action.fields) {
        const state = draft.fields[f.key];
        if (state.value !== null) filled.push(`${f.label.toLowerCase()} ${formatFieldValue(f, state.value)}`);
        else if (f.ask) blank.push(f.label.toLowerCase());
    }
    let msg = filled.length
        ? `Here's your ${action.label} -- ${filled.join(', ')}.`
        : `I don't have any details for this ${action.label} yet.`;
    if (blank.length) msg += ` Left blank: ${blank.join(', ')}.`;
    msg += ' Should I save this?';
    return msg;
}

// Confirm-card field rows (same shape the existing confirm-card UI expects).
export function draftToCardFields(draft) {
    const action = CONVERSATIONAL_ACTIONS[draft.action];
    return action.fields
        .filter(f => draft.fields[f.key].value !== null)
        .map(f => ({ k: f.label, v: formatFieldValue(f, draft.fields[f.key].value) }));
}

// Raw fields object handed to action.write() -- only actually-filled keys.
export function draftToRawFields(draft) {
    const out = {};
    for (const [key, state] of Object.entries(draft.fields)) {
        if (state.value !== null) out[key] = state.value;
    }
    return out;
}
