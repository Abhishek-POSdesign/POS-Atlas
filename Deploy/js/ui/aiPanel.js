// Atlas AI panel -- the docked overlay's Alpine component. Mounted once at
// the app-shell level in index.html (sibling to the header), not inside any
// page -- it needs to be reachable from anywhere in Atlas, same reasoning as
// the Notebook/Restore header overlays.
//
// Architecture notes (see the approved AI plan for full detail):
// - The AI never writes to Atlas directly. It only ever returns a draft;
//   confirmDraft() below is the one place that calls a real DB.* write
//   method, and only after Abhishek taps Confirm.
// - Every ordinary message carries the `explain_day` Fact Package as ambient
//   context (Phase 1 simplification -- the per-view context badge was cut
//   from this round's UI to de-clutter the header, so there's no separate
//   "About: Project X" binding yet; every conversation just always has
//   today's situation available).
// - The system prompt always includes the two Phase-1 write-flow extraction
//   instructions (log workout / log sleep), so a dictated or typed message
//   describing either can switch the model into structured-draft mode from
//   anywhere in the conversation, not just behind a specific quick-action.

import { DB } from '../db.js';
import { todayIsoDate } from '../date-utils.js';
import { askConfirm } from '../components/confirm-dialog.js';
import {
    loadConfig, saveConfig, loadPersona, savePersona,
    hasPin as pinExists, setPin, checkPin, clearPin,
    loadChatHistory, saveChatHistory, clearChatHistory,
    loadNotebookLocal, saveNotebookLocal, pushNotebook, pullNotebook,
    sendToProvider, buildSystemPrompt, getNotebookContext
} from '../features/aiConfig.js';
import { buildFactPackage, WRITE_FLOWS, sanitizeDraftFields } from '../features/aiContext.js';

const PERSONA_FIELD_DEFS = [
    { key: 'role', label: '1 · Role / Identity' },
    { key: 'job', label: '2 · Job Description' },
    { key: 'targets', label: '3 · Targets / KPIs' },
    { key: 'knowledge', label: '4 · Knowledge Hub / Domain' },
    { key: 'about', label: '5 · About Me' },
    { key: 'responsibilities', label: '6 · Responsibilities' },
    { key: 'instructions', label: '7 · Strict Instructions', hint: 'Always carries the no-silent-writes and reasoning-over-reciting rules, regardless of edits above.' }
];

function nowLabel() {
    return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function dayLabel(dateStr) {
    const today = todayIsoDate();
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    if (dateStr === today) return 'Today';
    if (dateStr === yesterday) return 'Yesterday';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

let speechRecognition = null; // module-level, not reactive -- avoids Alpine proxy issues with a browser API object
let _taskCache = null;        // populated from each explain_day package; used for complete_task resolution
let _checklistCache = null;   // populated from each explain_day package; used for mark_checklist resolution
let _checklistDate = null;    // todayKey() value matching _checklistCache; used as entry_date for setStatus()

export function atlasAi() {
    return {
        panelOpen: false,
        view: 'chat', // chat | notebook | settings | persona
        modelMenuOpen: false,

        provider: 'ollama',
        model: '',
        endpoint: 'http://localhost:11434',
        webSearch: false,
        voiceReply: false,
        voiceName: '',
        voiceList: [],

        messages: [],
        draft: '',
        thinking: false,
        errorMsg: '',
        listening: false,
        pendingUseCase: null,

        notebookEntries: [],

        persona: {},
        personaFieldDefs: PERSONA_FIELD_DEFS,
        personaUnlocked: false,
        personaSaved: false,
        hasPin: false,
        pinInput: '',
        pinError: '',

        init() {
            // Measure Atlas's own sticky header so the panel docks flush
            // underneath it with zero gap, instead of a hardcoded pixel guess.
            this._measureHeaderHeight();
            window.addEventListener('resize', () => this._measureHeaderHeight());

            const cfg = loadConfig();
            this.provider = cfg.provider;
            this.model = cfg.model;
            this.endpoint = cfg.endpoint;
            this.webSearch = !!cfg.webSearch;
            this.voiceReply = !!cfg.voiceReply;
            this.voiceName = cfg.voiceName || '';
            this.persona = loadPersona();

            // Populate voice list — voices load asynchronously on some browsers
            const loadVoices = () => {
                const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
                if (voices.length) this.voiceList = voices.map(v => ({ name: v.name, lang: v.lang }));
            };
            loadVoices();
            if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;
            this.hasPin = pinExists();
            this.messages = loadChatHistory();
            this.notebookEntries = loadNotebookLocal();
            pullNotebook().then(() => { this.notebookEntries = loadNotebookLocal(); });
        },
        _measureHeaderHeight() {
            const el = document.querySelector('.app-header-sticky');
            if (el) document.documentElement.style.setProperty('--atlas-header-h', el.offsetHeight + 'px');
        },

        openPanel() { this.panelOpen = true; this.$nextTick(() => this._scrollToBottom()); },
        closePanel() { this.panelOpen = false; this.modelMenuOpen = false; },

        setProvider(p) {
            this.provider = p;
            saveConfig({ provider: p, model: this.model, endpoint: this.endpoint, webSearch: this.webSearch });
            this.modelMenuOpen = false;
        },
        saveProviderConfig() {
            saveConfig({ provider: this.provider, model: this.model, endpoint: this.endpoint, webSearch: this.webSearch, voiceReply: this.voiceReply, voiceName: this.voiceName });
        },
        // Called by @change on the voice-reply checkbox. x-model already toggled
        // this.voiceReply; this function only saves + cancels queued speech.
        onVoiceReplyChange() {
            saveConfig({ provider: this.provider, model: this.model, endpoint: this.endpoint, webSearch: this.webSearch, voiceReply: this.voiceReply, voiceName: this.voiceName });
            if (!this.voiceReply && window.speechSynthesis) window.speechSynthesis.cancel();
        },
        onVoiceNameChange() {
            saveConfig({ provider: this.provider, model: this.model, endpoint: this.endpoint, webSearch: this.webSearch, voiceReply: this.voiceReply, voiceName: this.voiceName });
        },
        _speak(text) {
            if (!this.voiceReply || !window.speechSynthesis) return;
            window.speechSynthesis.cancel();
            const clean = text
                .replace(/\[System:.*?\]/g, '')
                .replace(/⚠[^\n]*/g, '')
                .replace(/https?:\/\/\S+/g, '')
                .trim();
            if (!clean) return;
            const utt = new SpeechSynthesisUtterance(clean);
            utt.rate = 1.0;
            utt.pitch = 1;
            if (this.voiceName) {
                const voices = window.speechSynthesis.getVoices();
                const match = voices.find(v => v.name === this.voiceName);
                if (match) utt.voice = match;
            }
            window.speechSynthesis.speak(utt);
        },

        get messageGroups() {
            const groups = [];
            for (const m of this.messages) {
                const last = groups[groups.length - 1];
                if (last && last.date === m.date) last.items.push(m);
                else groups.push({ date: m.date, label: dayLabel(m.date), items: [m] });
            }
            return groups;
        },

        _pushMessage(msg) {
            this.messages.push(Object.assign({ id: crypto.randomUUID(), date: todayIsoDate(), time: nowLabel() }, msg));
            saveChatHistory(this.messages);
            this.$nextTick(() => this._scrollToBottom());
        },
        _pushAssistantText(text, providerLabel) {
            this._pushMessage({ role: 'assistant', type: 'text', text, providerLabel: providerLabel || null });
            this._speak(text);
        },
        _scrollToBottom() {
            const el = this.$refs.messagesEl;
            if (el) el.scrollTop = el.scrollHeight;
        },

        askQuickAction(useCase) {
            if (useCase === 'explain_day') { this.draft = 'Explain my day'; this.sendMessage(); }
            else if (useCase === 'explain_health') { this.draft = 'Give me a health check-in'; this.sendMessage(); }
            else if (useCase === 'explain_task') {
                this.pendingUseCase = 'explain_task';
                this._pushAssistantText("Which task would you like me to break down? Type its name and I'll take a look.");
            }
        },

        autoGrowComposer() {
            const el = this.$refs.composerEl;
            if (!el) return;
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 70) + 'px';
        },
        handleComposerEnter(event) {
            if (event.shiftKey) return; // let the newline through
            event.preventDefault();
            this.sendMessage();
        },

        async sendMessage() {
            const text = this.draft.trim();
            if (!text || this.thinking) return;
            this._pushMessage({ role: 'user', type: 'text', text });
            this.draft = '';
            this.errorMsg = '';
            this.$nextTick(() => this.autoGrowComposer());

            if (this.pendingUseCase === 'explain_task') {
                await this._handleTaskLookup(text);
                return;
            }
            await this._askModel(text, 'explain_day');
        },

        async _handleTaskLookup(text) {
            this.thinking = true;
            try {
                const tasks = await DB.Tasks.listActive();
                const match = tasks.find(t => t.name.toLowerCase().includes(text.toLowerCase()));
                if (!match) {
                    this._pushAssistantText(`I couldn't find a task matching "${text}" -- try typing more of its exact name.`);
                    this.thinking = false;
                    return;
                }
                this.pendingUseCase = null;
                await this._askModel(`Break down the task "${match.name}" into 3-6 concrete sub-steps.`, 'explain_task', match.id);
            } catch (e) {
                this.thinking = false;
                this._pushAssistantText('Atlas AI is unavailable right now: ' + e.message);
            }
        },

        async _askModel(userText, factUseCase, entityId) {
            this.thinking = true;
            try {
                const pkg = await buildFactPackage(factUseCase, entityId);
                // Cache task/checklist arrays from explain_day packages for client-side resolution
                if (pkg._taskList) _taskCache = pkg._taskList;
                if (pkg._checklistItems) _checklistCache = pkg._checklistItems;
                if (pkg._checklistDate != null) _checklistDate = pkg._checklistDate;

                const notebookCtx = getNotebookContext();
                let systemPrompt = buildSystemPrompt(this.persona, notebookCtx);
                systemPrompt += '\n\n## FACTS AVAILABLE IF RELEVANT (do not mention these for a greeting or small talk)\n' + JSON.stringify(pkg.facts, null, 1);

                // Client-side pre-classification: only attach the extraction
                // instruction that matches this message's intent. Sending both
                // sleep and workout instructions every time -- especially with
                // sleep values in the conversation history -- primes the model
                // to anchor on the wrong intent. When neither keyword set
                // matches, skip extraction instructions entirely so the model
                // just replies in prose.
                const detectedIntent = this._detectIntent(userText);
                if (detectedIntent) {
                    systemPrompt += '\n\n## DATA LOGGING (apply ONLY because this message matches "' + detectedIntent + '")\n';
                    // For complete_task and mark_checklist, prepend the current list
                    // so the model knows exactly what names/numbers to extract
                    let dynamicCtx = '';
                    if (detectedIntent === 'complete_task' && _taskCache && _taskCache.length) {
                        dynamicCtx = 'Current pending task list (use these 1-based numbers only):\n' +
                            _taskCache.map((t, i) => `${i + 1}. ${t.name}`).join('\n') + '\n';
                    } else if (detectedIntent === 'mark_checklist' && _checklistCache && _checklistCache.length) {
                        dynamicCtx = "Today's routine checklist items (use these exact names only):\n" +
                            _checklistCache.map(c => `· ${c.name}`).join('\n') + '\n';
                    }
                    systemPrompt += dynamicCtx + WRITE_FLOWS[detectedIntent].extractionInstruction;
                }

                // Build conversation history for the model. Exclude the
                // current userText -- it was already pushed to this.messages
                // by sendMessage() before _askModel was called, so we slice
                // to -1 to avoid sending it twice (duplicate user turns cause
                // Gemini to reject or misbehave). Confirm cards are included
                // as a brief "[saved / discarded]" note -- NO field values,
                // so prior sleep numbers don't prime the model for a workout.
                const historyMessages = this.messages.slice(0, -1).slice(-14);
                const apiMessages = [{ role: 'system', content: systemPrompt }];
                let lastRole = 'system';
                for (const m of historyMessages) {
                    let role, content;
                    if (m.type === 'text') {
                        role = m.role === 'user' ? 'user' : 'assistant';
                        content = m.text;
                    } else if (m.type === 'confirm' && m.decided) {
                        role = 'assistant';
                        // Intentionally omit field values to prevent value anchoring
                        content = m.decided === 'saved'
                            ? '[' + m.draft.title + ' was confirmed and saved. That intent is complete.]'
                            : '[Draft was discarded — nothing was saved.]';
                    } else {
                        continue;
                    }
                    // Merge consecutive same-role messages (Gemini requires strict alternation)
                    if (role === lastRole && apiMessages.length > 1) {
                        apiMessages[apiMessages.length - 1].content += '\n' + content;
                    } else {
                        apiMessages.push({ role, content });
                        lastRole = role;
                    }
                }
                // Ensure last message before the new user turn is 'assistant'
                // if the history ended on 'user' (can happen if history was
                // empty or all same-role); just append user turn directly.
                apiMessages.push({ role: 'user', content: userText });

                const cfg = { provider: this.provider, model: this.model, endpoint: this.endpoint, webSearch: this.webSearch };
                const reply = await sendToProvider(apiMessages, cfg);
                this._handleModelReply(reply, this._currentProviderLabel());
            } catch (e) {
                this._pushAssistantText('Atlas AI is unavailable right now (' + e.message + '). Check the provider in settings, or try the other one.');
            }
            this.thinking = false;
        },

        _currentProviderLabel() {
            if (this.provider === 'vertex') return 'Cloud · Gemini' + (this.webSearch ? ' (web)' : '');
            return 'Local · ' + (this.model || 'unknown');
        },

        _extractFirstJson(str) {
            const start = str.indexOf('{');
            if (start === -1) return null;
            let depth = 0; let inStr = false; let esc = false;
            for (let i = start; i < str.length; i++) {
                const ch = str[i];
                if (esc) { esc = false; continue; }
                if (ch === '\\') { esc = true; continue; }
                if (ch === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (ch === '{') depth++;
                else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(str.slice(start, i + 1)); } catch (e) { return null; } } }
            }
            return null;
        },

        _detectIntent(text) {
            const t = text.toLowerCase();
            const w = /\b(workout|exercise|training|cardio|strength|calories|gym|leg\s*day|push\s*day|pull\s*day|run(ning)?|jog(ging)?|swim(ming)?|cycling|lift(ing)?|weights?|squats?|deadlifts?|bench|hiit|yoga|burned|reps|sets|treadmill)\b/.test(t);
            const s = /\b(sle(ep|pt)|nap(ped)?|sleep\s*score|deep\s*sleep|rem\b|resting\s*(heart\s*rate|hr)|hrv|heart\s*rate\s*variability|woke\s*up|bed\s*time|hours?\s+(of\s+)?sleep)\b/.test(t);
            if (w && !s) return 'log_workout';
            if (s && !w) return 'log_sleep';
            // Task completion: requires "task" word + a clear completion verb
            if (/\btask\b/.test(t) && /\b(done|finish(ed)?|complet(e|ed)?|mark(ed)?(\s+done)?)\b/.test(t)) return 'complete_task';
            // Checklist marking: "skipped" or "I did/completed" without task context (workout/sleep already excluded above)
            if (/\bskipped?\b/.test(t) && !w && !s) return 'mark_checklist';
            if (/\bi\s+(did|completed|finished)\b/.test(t) && !/\btask\b/.test(t) && !w && !s) return 'mark_checklist';
            // Journal: emotional/reflective language
            if (/\b(felt|feeling|i\s+feel)\b/.test(t)) return 'journal_reflection';
            if (/\btoday\s+was\b/.test(t)) return 'journal_reflection';
            if (/\bi'?m\s+(proud|grateful|anxious|tired|happy|sad|frustrated|excited|worried|stressed|calm|confident|overwhelmed|relieved|energised?|drained)\b/.test(t)) return 'journal_reflection';
            return null;
        },

        _handleModelReply(reply, providerLabel) {
            let parsed = null;
            let jsonStr = reply.trim();
            const fenceMatch = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
            if (fenceMatch) jsonStr = fenceMatch[1].trim();
            try { parsed = JSON.parse(jsonStr); } catch (e) {
                parsed = this._extractFirstJson(jsonStr);
            }

            if (parsed && parsed.intent && WRITE_FLOWS[parsed.intent]) {
                // Dedicated handlers for flows that need client-side resolution before the confirm card
                if (parsed.intent === 'complete_task') {
                    this._handleTaskCompletion(parsed.fields || {}, providerLabel);
                    return;
                }
                if (parsed.intent === 'mark_checklist') {
                    this._handleChecklistMarking(parsed.fields || {}, providerLabel);
                    return;
                }
                // Generic WRITE_FLOWS path (log_workout, log_sleep, journal_reflection)
                const flow = WRITE_FLOWS[parsed.intent];
                const fields = sanitizeDraftFields(parsed.intent, parsed.fields);
                if (!fields || Object.keys(fields).length === 0) {
                    this._pushAssistantText("I heard that as a log entry but couldn't pull out any real values -- want to try again with the specific numbers?", providerLabel);
                    return;
                }
                const fieldRows = flow.fields
                    .filter(f => fields[f.key] !== undefined)
                    .map(f => ({ k: f.label, v: String(fields[f.key]) }));
                this._pushMessage({
                    role: 'assistant',
                    type: 'confirm',
                    draft: { title: flow.title, icon: flow.icon, fields: fieldRows, flowKey: parsed.intent, rawFields: fields },
                    decided: null
                });
                return;
            }
            this._pushAssistantText(reply, providerLabel);
            if (/\b(log(ged|ging)?|sav(ed|ing)|record(ed|ing)|draft(ed)?)\b/i.test(reply) && /\b(sleep|workout|exercise|duration|hours?\s+(of\s+)?sleep)\b/i.test(reply)) {
                this._pushAssistantText('⚠ Note: nothing was actually saved to Atlas. To log data, try again with the details (e.g. "slept 7 hours, score 80") and I\'ll show a confirm card you can tap to save.', null);
            }
        },

        // Resolves a task-completion intent against the cached task list.
        // Conservative: number = 1-based index only; name = exact normalized match only.
        // Ambiguous or unresolvable → prose clarification, no confirm card.
        _handleTaskCompletion(fields, providerLabel) {
            if (!_taskCache || !_taskCache.length) {
                this._pushAssistantText("I don't have the task list loaded yet -- try sending your message again.", providerLabel);
                return;
            }
            const normalize = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
            let task = null;
            if (fields.task_number != null) {
                const idx = Math.round(Number(fields.task_number)) - 1;
                if (idx >= 0 && idx < _taskCache.length) task = _taskCache[idx];
            }
            if (!task && fields.task_name) {
                const needle = normalize(String(fields.task_name));
                const matches = _taskCache.filter(t => normalize(t.name) === needle);
                if (matches.length === 1) task = matches[0];
            }
            if (!task) {
                const list = _taskCache.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
                this._pushAssistantText(
                    "I couldn't identify which task you meant. Say the task number or its exact name. Your pending tasks:\n" + list,
                    providerLabel
                );
                return;
            }
            this._pushMessage({
                role: 'assistant',
                type: 'confirm',
                draft: {
                    title: 'Draft · Complete task',
                    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
                    fields: [{ k: 'Task', v: task.name }],
                    flowKey: 'complete_task',
                    rawFields: { task_id: task.id, task_name: task.name }
                },
                decided: null
            });
        },

        // Resolves a checklist-marking intent against today's cached items.
        // Any single unresolved item blocks the ENTIRE confirm card -- no partial writes.
        _handleChecklistMarking(fields, providerLabel) {
            if (!_checklistCache || !_checklistCache.length) {
                this._pushAssistantText("I don't have today's routine items loaded -- try sending your message again.", providerLabel);
                return;
            }
            if (!fields.items || !fields.items.length) {
                this._pushAssistantText("I couldn't identify which routine items you meant. Try naming them exactly as they appear in your checklist.", providerLabel);
                return;
            }
            const normalize = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
            const resolved = [];
            const unresolved = [];
            for (const item of fields.items) {
                const needle = normalize(item.name || '');
                const match = _checklistCache.find(c => normalize(c.name) === needle);
                if (match) {
                    resolved.push({ id: match.id, name: match.name, status: item.status === 'skipped' ? 'skipped' : 'done' });
                } else {
                    unresolved.push(item.name || '?');
                }
            }
            if (unresolved.length > 0) {
                const available = _checklistCache.map(c => `· ${c.name}`).join('\n');
                this._pushAssistantText(
                    `I couldn't match: ${unresolved.map(n => '"' + n + '"').join(', ')}. Nothing was marked.\n\nYour routine items today:\n${available}\n\nTry again using the names exactly as listed.`,
                    providerLabel
                );
                return;
            }
            const doneItems = resolved.filter(r => r.status === 'done');
            const skippedItems = resolved.filter(r => r.status === 'skipped');
            const fieldRows = [];
            if (doneItems.length) fieldRows.push({ k: 'Done', v: doneItems.map(r => r.name).join(' · ') });
            if (skippedItems.length) fieldRows.push({ k: 'Skipped', v: skippedItems.map(r => r.name).join(' · ') });
            this._pushMessage({
                role: 'assistant',
                type: 'confirm',
                draft: {
                    title: 'Draft · Mark routine items',
                    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><polyline points="4 6 5 7 7 5"/><polyline points="4 12 5 13 7 11"/><polyline points="4 18 5 19 7 17"/></svg>',
                    fields: fieldRows,
                    flowKey: 'mark_checklist',
                    rawFields: { resolved, date: _checklistDate }
                },
                decided: null
            });
        },

        async confirmDraft(msg) {
            const flow = WRITE_FLOWS[msg.draft.flowKey];
            if (!flow) return;
            try {
                await flow.write(msg.draft.rawFields);
                msg.decided = 'saved';
            } catch (e) {
                msg.decided = null;
                this.errorMsg = 'Save failed: ' + e.message;
            }
            saveChatHistory(this.messages);
        },
        cancelDraft(msg) {
            msg.decided = 'cancelled';
            saveChatHistory(this.messages);
        },

        async pinMessage(m) {
            m.pinned = true;
            let summary = m.text.length > 350 ? m.text.slice(0, 350) + '...' : m.text;
            try {
                const cfg = { provider: this.provider, model: this.model, endpoint: this.endpoint };
                const reply = await sendToProvider([
                    { role: 'system', content: 'Summarize the following AI response in 2-3 plain lines -- the key insight, decision, or fact. No preamble, just the summary.' },
                    { role: 'user', content: m.text }
                ], cfg);
                if (reply && reply.trim()) summary = reply.trim();
            } catch (e) { /* fallback to the verbatim slice already set above */ }
            this._addNotebookEntry('pin', summary);
        },

        async saveSession() {
            const recent = this.messages.filter(m => m.type === 'text' || (m.type === 'confirm' && m.decided)).slice(-10);
            if (!recent.length) return;
            const transcript = recent.map(m => {
                if (m.type === 'confirm') return 'assistant: [' + (m.decided === 'saved' ? 'Saved ' + m.draft.title : 'Discarded draft') + ']';
                return `${m.role}: ${m.text}`;
            }).join('\n');
            let summary = 'Session covered: ' + recent.filter(m => m.role === 'user').map(m => m.text).slice(0, 3).join('; ');
            try {
                const cfg = { provider: this.provider, model: this.model, endpoint: this.endpoint };
                const reply = await sendToProvider([
                    { role: 'system', content: 'Summarize this conversation in 4-6 plain lines: key questions, facts discussed, and any decisions or action items. No preamble.' },
                    { role: 'user', content: transcript }
                ], cfg);
                if (reply && reply.trim()) summary = reply.trim();
            } catch (e) { /* fallback summary already set above */ }
            this._addNotebookEntry('session', summary);
        },

        async compactNotebook() {
            if (!this.notebookEntries.length) return;
            const all = this.notebookEntries.map(e => `[${e.type}] ${e.text}`).join('\n');
            let summary = 'Standing notes: ' + this.notebookEntries.map(e => e.text.slice(0, 80)).join(' | ');
            try {
                const cfg = { provider: this.provider, model: this.model, endpoint: this.endpoint };
                const reply = await sendToProvider([
                    { role: 'system', content: 'Consolidate these AI-notebook entries into one 8-12 line brief, grouped by theme (standing rules, active goals, resolved questions, open items). No preamble.' },
                    { role: 'user', content: all }
                ], cfg);
                if (reply && reply.trim()) summary = reply.trim();
            } catch (e) { /* fallback summary already set above */ }
            const first = this.notebookEntries[this.notebookEntries.length - 1];
            const last = this.notebookEntries[0];
            this.notebookEntries = [{ type: 'compact', date: `covers ${first.date}–${last.date}`, text: summary }];
            saveNotebookLocal(this.notebookEntries);
            pushNotebook(this.notebookEntries);
        },

        _addNotebookEntry(type, text) {
            this.notebookEntries.unshift({ type, date: dayLabel(todayIsoDate()) === 'Today' ? new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : todayIsoDate(), text });
            saveNotebookLocal(this.notebookEntries);
            pushNotebook(this.notebookEntries);
        },
        deleteNotebookEntry(i) {
            this.notebookEntries.splice(i, 1);
            saveNotebookLocal(this.notebookEntries);
            pushNotebook(this.notebookEntries);
        },

        async askClearChat() {
            const ok = await askConfirm("Clear this conversation? This can't be undone.", { confirmLabel: 'Clear' });
            if (!ok) return;
            this.messages = [];
            clearChatHistory();
        },

        toggleVoice() {
            if (speechRecognition) { speechRecognition.stop(); return; }
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) { this.errorMsg = 'Voice input is not supported in this browser.'; return; }
            speechRecognition = new SpeechRecognition();
            speechRecognition.lang = 'en-US';
            speechRecognition.interimResults = false;
            speechRecognition.continuous = true;
            speechRecognition.onstart = () => { this.listening = true; this.errorMsg = ''; };
            speechRecognition.onresult = (event) => {
                let transcript = '';
                for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
                this.draft = (this.draft ? this.draft + ' ' : '') + transcript.trim();
                this.$nextTick(() => this.autoGrowComposer());
            };
            speechRecognition.onerror = (event) => {
                this.errorMsg = 'Voice input error: ' + event.error + ' -- you can still type.';
                if (speechRecognition) speechRecognition.stop();
            };
            speechRecognition.onend = () => { speechRecognition = null; this.listening = false; };
            speechRecognition.start();
        },

        // Keyboard shortcut for voice, requested directly: Alt+M toggles
        // listening on/off, same underlying toggleVoice() the mic button
        // calls -- a second way in if the mic button itself isn't
        // registering a click for some reason (small touch target, focus
        // stolen by the composer, etc.), and a faster path for repeat use.
        handleGlobalKey(event) {
            if (!this.panelOpen || this.view !== 'chat') return;
            if (event.altKey && event.key.toLowerCase() === 'm') {
                event.preventDefault();
                this.toggleVoice();
            }
        },

        // ---- persona / PIN ----
        pinTap(n) {
            if (this.pinInput.length >= 6) return;
            this.pinInput += String(n);
            this.pinError = '';
            if (this.pinInput.length === 6) this._submitPin();
        },
        pinBackspace() { this.pinInput = this.pinInput.slice(0, -1); },
        async _submitPin() {
            if (this.hasPin) {
                const ok = await checkPin(this.pinInput);
                if (ok) { this.personaUnlocked = true; this.pinInput = ''; }
                else { this.pinError = 'Incorrect PIN'; this.pinInput = ''; }
            } else {
                await setPin(this.pinInput);
                this.hasPin = true;
                this.personaUnlocked = true;
                this.pinInput = '';
            }
        },
        forgotPin() {
            clearPin();
            this.hasPin = false;
            this.pinInput = '';
            this.pinError = 'PIN cleared -- persona and notebook untouched. Enter 6 new digits to set a fresh PIN.';
        },
        async startPinChange() {
            clearPin();
            this.hasPin = false;
            this.personaUnlocked = false;
            this.pinInput = '';
            this.pinError = 'Enter 6 new digits to set a fresh PIN.';
        },
        savePersonaNow() {
            savePersona(this.persona);
            this.personaSaved = true;
            setTimeout(() => { this.personaSaved = false; }, 1500);
        },
        // Discards any unsaved edits in the textareas by reloading the last
        // saved copy from storage -- the fields are bound with x-model but
        // never auto-save on their own now, only the explicit Save button
        // does (Abhishek's feedback: editing without a visible Save felt
        // like the edits weren't really being kept).
        reloadPersona() {
            this.persona = loadPersona();
        }
    };
}
