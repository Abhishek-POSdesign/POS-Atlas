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

export function atlasAi() {
    return {
        panelOpen: false,
        view: 'chat', // chat | notebook | settings | persona
        modelMenuOpen: false,

        provider: 'ollama',
        model: '',
        endpoint: 'http://localhost:11434',
        webSearch: false,

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
            this.persona = loadPersona();
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
            saveConfig({ provider: this.provider, model: this.model, endpoint: this.endpoint, webSearch: this.webSearch });
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
                const notebookCtx = getNotebookContext();
                let systemPrompt = buildSystemPrompt(this.persona, notebookCtx);
                // Framed as "available if relevant," not "always in play" --
                // this is the other half of the conversation-first fix (the
                // rule itself lives in buildSystemPrompt(), this is where the
                // data actually gets attached, so the framing has to match
                // here too or the rule and the data contradict each other).
                systemPrompt += '\n\n## FACTS AVAILABLE IF RELEVANT (do not mention these for a greeting or small talk)\n' + JSON.stringify(pkg.facts, null, 1);
                systemPrompt += '\n\n## VOICE-WRITE EXTRACTION RULES (only apply if the message matches)\n';
                systemPrompt += WRITE_FLOWS.log_workout.extractionInstruction + '\n' + WRITE_FLOWS.log_sleep.extractionInstruction;

                const apiMessages = [{ role: 'system', content: systemPrompt }];
                // Last few turns of real conversation history for continuity --
                // not the whole session, keeps the prompt small.
                const recent = this.messages.filter(m => m.type === 'text').slice(-8);
                for (const m of recent) apiMessages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
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

        _handleModelReply(reply, providerLabel) {
            let parsed = null;
            try { parsed = JSON.parse(reply.trim()); } catch (e) { /* not a draft -- plain prose reply */ }

            if (parsed && parsed.intent && WRITE_FLOWS[parsed.intent]) {
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
            const recent = this.messages.filter(m => m.type === 'text').slice(-10);
            if (!recent.length) return;
            const transcript = recent.map(m => `${m.role}: ${m.text}`).join('\n');
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
