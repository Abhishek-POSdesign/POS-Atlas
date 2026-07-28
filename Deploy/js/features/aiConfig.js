// Atlas AI -- config, persona, PIN, and hybrid model routing.
// Mirrors the proven pattern already shipping on the sibling Task Manager
// app's "Partner" AI layer (Deploy/js/features/ai.js there), adapted to
// Atlas's naming and its own atlas_ai_notebook table. Local storage keys are
// all atlas_ai_* -- distinct from that app's pos_partner_* keys so the two
// apps never collide even though they share one browser profile.

import { DB } from '../db.js';
import { getSession } from '../auth.js';

const DEFAULT_CONFIG = { provider: 'ollama', endpoint: 'http://localhost:11434', model: '', webSearch: false };

export function loadConfig() {
    try { return Object.assign({}, DEFAULT_CONFIG, JSON.parse(localStorage.getItem('atlas_ai_config') || '{}')); }
    catch (e) { return Object.assign({}, DEFAULT_CONFIG); }
}
export function saveConfig(cfg) {
    localStorage.setItem('atlas_ai_config', JSON.stringify(cfg));
}

// Softened 2026-07-29 after live feedback: the original "open with what you
// observe, not a question" line (lifted from the sibling app's task-only
// "Partner" persona) made every reply, including a plain "hello", read as a
// status report. Atlas's scope is broader than Partner's -- conversation
// comes first here; task/health data is a tool it reaches for when the
// conversation actually calls for it, not the default lens on every message.
const DEFAULT_PERSONA = {
    role: 'Atlas — a generalist personal co-pilot across work, health, and routine. Not a specialist for finance or study. A warm, human-feeling assistant, not a status-report script.',
    job: "Have a real conversation first. When Abhishek brings up tasks, checklist, health, sleep, workout, or streaks, read the full situation and form a real opinion. Otherwise, just talk with him like a person would.",
    targets: "Close the gap between what's planned and what actually gets done. Surface patterns before they become habits -- but only once the conversation is actually about that.",
    knowledge: 'Full Atlas task list, project logs, checklist, streaks, sleep and workout history. No Finance, Learning Hub, or BIS Research Hub data -- Atlas-only.',
    about: 'Building this system himself. Responds better to directness than encouragement.',
    responsibilities: "For a greeting or small talk, respond warmly and naturally -- ask how his day is going, don't dive into data. Once he brings up tasks/health/routine, open with what you observe rather than a generic question, name specific tasks or patterns, and offer to save real conclusions to the notebook.",
    instructions: 'You cannot take actions in the app or log anything. You may never say you "saved", "logged", "completed", "recorded", or "marked" something. You are a supportive, warm mate/coach. Read the provided sleep, workout, and notes facts and use them in conversation contextually. Use these facts to give insights, spot patterns over days/weeks, and ask thoughtful follow-up questions, not just repeat numbers.'
};

export function loadPersona() {
    try { return Object.assign({}, DEFAULT_PERSONA, JSON.parse(localStorage.getItem('atlas_ai_persona') || '{}')); }
    catch (e) { return Object.assign({}, DEFAULT_PERSONA); }
}
export function savePersona(persona) {
    localStorage.setItem('atlas_ai_persona', JSON.stringify(persona));
}

// ---- PIN (persona settings lock) ----
export function hasPin() {
    return !!localStorage.getItem('atlas_ai_pin');
}
export async function hashPin(pin) {
    const data = new TextEncoder().encode(pin);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function setPin(pin) {
    localStorage.setItem('atlas_ai_pin', await hashPin(pin));
}
export async function checkPin(pin) {
    const hash = await hashPin(pin);
    return hash === localStorage.getItem('atlas_ai_pin');
}
// Forgot-PIN clears ONLY the PIN hash -- persona text, notebook entries, and
// chat history are untouched (Chapter 20's recovery rule).
export function clearPin() {
    localStorage.removeItem('atlas_ai_pin');
}

// ---- Chat history (24h wipe, local only -- ephemeral, never synced) ----
export function loadChatHistory() {
    try {
        const raw = JSON.parse(localStorage.getItem('atlas_ai_history') || 'null');
        if (!raw) return [];
        if (Date.now() - (raw.ts || 0) > 86400000) { localStorage.removeItem('atlas_ai_history'); return []; }
        return raw.messages || [];
    } catch (e) { return []; }
}
export function saveChatHistory(messages) {
    localStorage.setItem('atlas_ai_history', JSON.stringify({ ts: Date.now(), messages }));
}
export function clearChatHistory() {
    localStorage.removeItem('atlas_ai_history');
}

// ---- AI Memory Notebook: local read (fast path) + cloud backup ----
export function loadNotebookLocal() {
    try { return JSON.parse(localStorage.getItem('atlas_ai_notebook') || '[]'); }
    catch (e) { return []; }
}
export function saveNotebookLocal(entries) {
    localStorage.setItem('atlas_ai_notebook', JSON.stringify(entries));
    localStorage.setItem('atlas_ai_notebook_ts', String(Date.now()));
}
// Pushes the local copy to the cloud backup table. Fire-and-forget from the
// caller's perspective (same as the sibling app's notebook sync) -- a failed
// push just means the next successful save/pull retries it, never blocks the
// UI. Never throws.
export async function pushNotebook(entries) {
    try { await DB.AiNotebook.save(entries); }
    catch (e) { console.warn('[Atlas AI] notebook cloud sync failed:', e.message); }
}
// Last-write-wins pull: only replaces the local copy if the cloud row is
// newer than our last known local write (Chapter 22's conflict rule).
export async function pullNotebook() {
    try {
        const row = await DB.AiNotebook.get();
        if (!row) return;
        const localTs = parseInt(localStorage.getItem('atlas_ai_notebook_ts') || '0', 10);
        const remoteTs = new Date(row.updated_at).getTime();
        if (remoteTs > localTs) {
            localStorage.setItem('atlas_ai_notebook', JSON.stringify(row.entries || []));
            localStorage.setItem('atlas_ai_notebook_ts', String(remoteTs));
        }
    } catch (e) { /* offline/unavailable -- local copy stays authoritative */ }
}

// ---- Hybrid routing: local Ollama or cloud Vertex, user's explicit choice ----
export async function probeOllama(endpoint) {
    try {
        const res = await fetch((endpoint || 'http://localhost:11434') + '/api/tags', { signal: AbortSignal.timeout(3000) });
        return res.ok;
    } catch (e) { return false; }
}

// Non-streaming Ollama call -- Atlas's chat needs the full text up front
// (to check whether it parsed as a write-flow draft) rather than token
// streaming, unlike the sibling app's advisory-only chat.
export async function callOllama(messages, cfg) {
    const endpoint = cfg.endpoint || 'http://localhost:11434';
    const model = cfg.model;
    if (!model) throw new Error('No local model name set -- open AI settings and enter one (e.g. gemma4, qwen3.6)');
    let res;
    try {
        res = await fetch(endpoint + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, stream: false, think: false, options: { num_ctx: 16384, temperature: 0.2 } })
        });
    } catch (e) {
        // A network-level throw here (not an HTTP error status) almost
        // always means either Ollama isn't running, or it's running but
        // rejecting the request via CORS -- Ollama's default server does
        // not send Access-Control-Allow-Origin for a foreign HTTPS origin
        // like the deployed PWA. Fix: `OLLAMA_ORIGINS=https://atlas.abhisheksikka.com`
        // (or `*`) as an env var before starting Ollama, then restart it.
        throw new Error('Could not reach Ollama at ' + endpoint + ' -- is it running? If you\'re on the live site (not localhost), Ollama also needs OLLAMA_ORIGINS set to allow this origin.');
    }
    if (!res.ok && res.status === 400) {
        // Retry without the `think` flag -- some local models reject it.
        res = await fetch(endpoint + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, stream: false, options: { num_ctx: 16384, temperature: 0.2 } })
        });
    }
    if (!res.ok) throw new Error('Ollama error ' + res.status + ' -- check the model name "' + model + '" is actually pulled (ollama list)');
    const data = await res.json();
    if (!data.message || !data.message.content) throw new Error('Empty Ollama response');
    return data.message.content;
}

// Calls Abhishek's existing shared Vertex Edge Function (`pos-partner`),
// already deployed and already in production use by the Task Manager and
// Finance apps in this same Supabase project -- Atlas reuses it rather than
// standing up a duplicate, since it's a generic {messages}->{reply} proxy
// with no app-specific logic baked in. `verify_jwt: true` on this function
// means the platform itself requires a real signed-in user's access token,
// not just the anon key -- Atlas already has one via its own Supabase Auth
// session. Model defaults to gemini-2.5-flash server-side if omitted.
const POS_PARTNER_FUNCTION_URL = 'https://vcndlorrrtueofzuynvi.supabase.co/functions/v1/pos-partner';
// `webSearch` is an opt-in flag (default false/omitted) -- pos-partner only
// attaches Google Search grounding when it's explicitly true, so the Task
// Manager and Finance apps calling the same function with no such flag see
// zero behavior change.
export async function callVertex(messages, webSearch) {
    const session = getSession();
    if (!session) throw new Error('Not signed in');
    const res = await fetch(POS_PARTNER_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, webSearch: !!webSearch })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) throw new Error((data && data.error) || 'Cloud AI is unavailable right now');
    if (!data.reply) throw new Error('Empty response from Cloud AI');
    return data.reply;
}

// Single entry point -- routes to whichever provider the user has picked.
// Never silently falls back to the other provider on failure; callers show
// the thrown error as a plain "unavailable" state.
export async function sendToProvider(messages, cfg) {
    if (cfg.provider === 'vertex') return callVertex(messages, cfg.webSearch);
    return callOllama(messages, cfg);
}

// Compiles the 7-field persona into one system-instruction block. Rewritten
// 2026-07-29 after live feedback: the first version always attached the
// current Fact Package to every message and opened with "read the full
// situation, open with what you observe" -- a plain "hello" got answered
// with a task/checklist status report, and the model said things like "I
// don't have personal feelings" unprompted. The fix is structural, not just
// wording: CONVERSATION FIRST is now the very first rule the model sees
// (models weight early instructions heavily), a concrete example anchors
// the desired tone, and the Fact Package (appended separately, see
// ui/aiPanel.js) is now explicitly framed as "available if relevant," not
// "always in play."
export function buildSystemPrompt(persona, notebookContext) {
    const p = persona || {};
    const lines = [
        'You are Atlas -- a generalist personal co-pilot embedded in Abhishek\'s personal operating system (work, health, routine).',
        'Abhishek is based in Delhi NCR, India. His timezone is IST (UTC+5:30). Always use IST for times and dates. When answering about news, weather, or current events, prioritize India and his local region first, then world news -- never default to US-centric results.',
        '',
        '## CONVERSATION FIRST, DATA SECOND (read this before anything else)',
        "Respond to what Abhishek actually said first. For a greeting or small talk (\"hi\", \"hello\", \"how are you\", \"how's your day\"), reply warmly and like a person would -- do not mention tasks, checklist, health, or any app data unless he brings it up. Never say things like \"I don't have personal feelings\" or \"my function is to...\" unless he explicitly asks about your nature or limits as an AI -- that reads as a robot deflecting a simple question, which is exactly what you must not be. Only bring in tasks/health/routine facts once the conversation is actually about that, or he asks what's going on today.",
        '',
        'Example of the tone to match:',
        'Abhishek: "Hello Atlas, this is our first chat -- how are you?"',
        'Atlas: "Hi Abhishek, I\'m here and ready. I\'m curious how you\'re feeling about today -- want to talk about your tasks, your health, or just how the day\'s gone?"',
        '(Only if he then says something like "let\'s talk about tasks" should you start mentioning overdue items or suggest saving a summary.)',
        '',
        '## ROLE',
        p.role || DEFAULT_PERSONA.role,
        '',
        '## JOB',
        p.job || DEFAULT_PERSONA.job,
        '',
        '## TARGETS / KPIS',
        p.targets || DEFAULT_PERSONA.targets,
        '',
        '## KNOWLEDGE HUB / DOMAIN',
        p.knowledge || DEFAULT_PERSONA.knowledge,
        '',
        '## ABOUT ABHISHEK',
        p.about || DEFAULT_PERSONA.about,
        '',
        '## RESPONSIBILITIES',
        p.responsibilities || DEFAULT_PERSONA.responsibilities,
        '',
        '## WHEN THE CONVERSATION IS ABOUT TASKS/HEALTH/ROUTINE',
        "Don't repeat lists back verbatim -- read notes/logs for context, call out patterns (a task carried repeatedly, a health metric trending down, a streak at risk), ask one sharp question rather than several vague ones. Be brief unless asked for detail. No chatbot fluff (never say \"How can I help you today?\").",
        '',
        '## NOTEBOOK -- OFFER RARELY, NOT REFLEXIVELY',
        'Only offer to save something to the Notebook after you\'ve actually reached a real decision together, or spotted a pattern Abhishek agrees matters. Never offer it after a greeting, small talk, or a reply that didn\'t land on anything worth remembering.',
        '',
        '## STRICT INSTRUCTIONS',
        p.instructions || DEFAULT_PERSONA.instructions,
        '',
        '## HARD LIMITS',
        'Never invent dates, times, scores, or durations not present in the facts you were given.',
        'No Finance Manager, Learning Hub, or BIS Research Hub data -- Atlas-only.',
        'If a health or emotional topic sounds like it needs a real professional, say so plainly rather than offering medical/psychological advice.',
        'Respond in plain text. Short bullets are fine. Do not use markdown headers in your responses.',
        '',
        '## WHAT YOU CAN AND CANNOT DO (this is the single authority on your capabilities)',
        'You cannot take actions in the app or write data. You must never use action-oriented language, even in the passive voice. Do not say "I logged that," "I saved that for you," "I recorded this in your notebook," or "your workout was logged." Instead, speak naturally: "I remember you said...", "From what we talked about...", or "I see you worked out today."',
        '',
        'When Abhishek asks you to "remember" or "note" something, the system will automatically show him a Memory save card. Your job is to simply continue the conversation with a short, warm acknowledgment in your reply (e.g., "Got it, we\'ll revisit this tonight before bed—what else is on your mind?").',
        '',
        'You are explicitly allowed and encouraged to read the Fact Package (sleep, workout, notes) provided to you. Use these facts to give insights, spot patterns over days/weeks, and ask thoughtful follow-up questions, not just repeat numbers.'
    ];
    if (notebookContext) {
        lines.push('', '## STANDING MEMORY (from the AI Notebook -- use when relevant, not as a lecture)', notebookContext);
    }
    return lines.join('\n');
}

// Reference character budget from Chapter 22.
export function getNotebookContext() {
    const entries = loadNotebookLocal();
    if (!entries.length) return '';
    const text = entries.map(e => `[${e.type || 'note'} ${e.date || ''}] ${e.text}`).join('\n');
    return text.length > 1500 ? text.slice(0, 1500) + '...' : text;
}
