// Atlas AI -- config, persona, PIN, and hybrid model routing.
// Mirrors the proven pattern already shipping on the sibling Task Manager
// app's "Partner" AI layer (Deploy/js/features/ai.js there), adapted to
// Atlas's naming and its own atlas_ai_notebook table. Local storage keys are
// all atlas_ai_* -- distinct from that app's pos_partner_* keys so the two
// apps never collide even though they share one browser profile.

import { DB } from '../db.js';

const DEFAULT_CONFIG = { provider: 'ollama', endpoint: 'http://localhost:11434', model: 'llama3.2' };

export function loadConfig() {
    try { return Object.assign({}, DEFAULT_CONFIG, JSON.parse(localStorage.getItem('atlas_ai_config') || '{}')); }
    catch (e) { return Object.assign({}, DEFAULT_CONFIG); }
}
export function saveConfig(cfg) {
    localStorage.setItem('atlas_ai_config', JSON.stringify(cfg));
}

const DEFAULT_PERSONA = {
    role: 'Atlas — a generalist personal co-pilot across work, health, and routine. Not a specialist for finance or study.',
    job: "Read the full day's situation across tasks, checklist, health, and streaks. Form a real opinion and open with what you notice.",
    targets: "Close the gap between what's planned and what actually gets done. Surface patterns before they become habits.",
    knowledge: 'Full Atlas task list, project logs, checklist, streaks, sleep and workout history. No Finance, Learning Hub, or BIS Research Hub data -- Atlas-only.',
    about: 'Building this system himself. Responds better to directness than encouragement.',
    responsibilities: 'Open with what you observe, not a question. Name specific tasks or patterns. Offer to save real conclusions to the notebook.',
    instructions: 'Never write to Atlas directly -- always propose, rephrase back, and wait for explicit confirmation. Reason about what matters; never just recite numbers.'
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
    const model = cfg.model || 'llama3.2';
    let res = await fetch(endpoint + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, think: false, options: { num_ctx: 16384, temperature: 0.2 } })
    });
    if (!res.ok && res.status === 400) {
        // Retry without the `think` flag -- some local models reject it.
        res = await fetch(endpoint + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, stream: false, options: { num_ctx: 16384, temperature: 0.2 } })
        });
    }
    if (!res.ok) throw new Error('Ollama error ' + res.status);
    const data = await res.json();
    if (!data.message || !data.message.content) throw new Error('Empty Ollama response');
    return data.message.content;
}

// Calls a dedicated Atlas Supabase Edge Function (not the sibling app's
// `pos-partner` -- Atlas gets its own, matching the module-independence
// convention every other Atlas backend object already follows). The
// function itself (holding the real Vertex/Gemini secret server-side) is
// not deployed yet -- this call will fail gracefully with a clear
// "unavailable" message until that Edge Function is set up, exactly the
// failure mode the plan calls for (never a silent fallback).
const ATLAS_AI_FUNCTION_URL = 'https://vcndlorrrtueofzuynvi.supabase.co/functions/v1/atlas-ai';
export async function callVertex(messages, anonKey) {
    const res = await fetch(ATLAS_AI_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) throw new Error((data && data.error) || 'Cloud AI is unavailable right now');
    if (!data.reply) throw new Error('Empty response from Cloud AI');
    return data.reply;
}

// Single entry point -- routes to whichever provider the user has picked.
// Never silently falls back to the other provider on failure; callers show
// the thrown error as a plain "unavailable" state.
export async function sendToProvider(messages, cfg, anonKey) {
    if (cfg.provider === 'vertex') return callVertex(messages, anonKey);
    return callOllama(messages, cfg);
}

// Compiles the 7-field persona into one system-instruction block, plus the
// always-on hard limits (no silent writes, no data-reciting). Reused
// verbatim shape from the sibling app's buildSystemPrompt(), adapted to
// Atlas's broader generalist scope.
export function buildSystemPrompt(persona, notebookContext) {
    const p = persona || {};
    const lines = [
        'You are Atlas -- a generalist personal co-pilot embedded in Abhishek\'s personal operating system (work, health, routine).',
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
        '## HOW TO ADD VALUE (most important rule)',
        "Abhishek's single highest priority: reason and converse like a co-pilot, never just recite numbers. Don't repeat lists back verbatim -- read notes/logs for context, call out patterns (a task carried repeatedly, a health metric trending down, a streak at risk), ask one sharp question rather than several vague ones, and offer to save real conclusions to the Notebook. Be brief unless asked for detail. No chatbot fluff (never say \"How can I help you today?\").",
        '',
        '## STRICT INSTRUCTIONS',
        p.instructions || DEFAULT_PERSONA.instructions,
        '',
        '## HARD LIMITS',
        'Never write to Atlas directly -- you only ever propose a draft; the app writes after Abhishek explicitly confirms.',
        'Never invent dates, times, scores, or durations not present in the facts you were given.',
        'No Finance Manager, Learning Hub, or BIS Research Hub data -- Atlas-only.',
        'If a health or emotional topic sounds like it needs a real professional, say so plainly rather than offering medical/psychological advice.',
        'Respond in plain text. Short bullets are fine. Do not use markdown headers in your responses.'
    ];
    if (notebookContext) {
        lines.push('', '## STANDING MEMORY (from the AI Notebook -- use when relevant)', notebookContext);
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
