// Atlas AI panel -- the docked overlay's Alpine component. Mounted once at
// the app-shell level in index.html (sibling to the header), not inside any
// page -- it needs to be reachable from anywhere in Atlas, same reasoning as
// the Notebook/Restore header overlays.
//
// Architecture (action-layer rebuild 2026-07-28):
// - Write-intent messages fire TWO model calls in parallel:
//     1. Extraction call: minimal context (schema + user message only),
//        returns JSON or null. Never has persona or history -- it can't be
//        pulled toward prose by a "conversation first" instruction.
//     2. Prose call: full persona + history, no extraction instruction.
//        Returns natural conversational text.
//   The prose reply is displayed; if extraction returned valid fields, a
//   confirm card is pushed below it.
// - AI Memory save (save_ai_memory) bypasses the model entirely: client-side
//   phrase detection pushes a confirm card immediately. Confirm path awaits
//   both local write and cloud push before speaking "Done."
// - pendingUseCase ('explain_task') auto-expires after 90 seconds and always
//   clears after one lookup attempt regardless of match success.
// - confirmDraft() never speaks "Done." before the DB write is confirmed.

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

let speechRecognition = null;   // module-level, not reactive -- avoids Alpine proxy issues with a browser API object
let _taskCache = null;          // populated from explain_day packages; used for complete_task resolution
let _checklistCache = null;     // populated from explain_day packages; used for mark_checklist resolution
let _checklistDate = null;      // todayKey() value matching _checklistCache
let _pendingUseCaseExpiry = 0;  // timestamp after which pendingUseCase auto-clears (90s window)

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

            const loadVoices = () => {
                const cloudVoices = [
                    { name: 'atlas_calm', lang: 'Cloud TTS', label: 'Atlas Calm' },
                    { name: 'atlas_clear', lang: 'Cloud TTS', label: 'Atlas Clear' }
                ];
                const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
                this.voiceList = [
                    ...cloudVoices,
                    ...(voices.length ? voices.map(v => ({ name: v.name, lang: v.lang, label: v.name })) : [])
                ];
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
        closePanel() {
            this.panelOpen = false;
            this.modelMenuOpen = false;
            if (window.speechSynthesis) window.speechSynthesis.cancel();
        },

        setProvider(p) {
            this.provider = p;
            saveConfig({ provider: p, model: this.model, endpoint: this.endpoint, webSearch: this.webSearch });
            this.modelMenuOpen = false;
        },
        saveProviderConfig() {
            saveConfig({ provider: this.provider, model: this.model, endpoint: this.endpoint, webSearch: this.webSearch, voiceReply: this.voiceReply, voiceName: this.voiceName });
        },
        onVoiceReplyChange() {
            saveConfig({ provider: this.provider, model: this.model, endpoint: this.endpoint, webSearch: this.webSearch, voiceReply: this.voiceReply, voiceName: this.voiceName });
            if (this.currentCloudAudio) { this.currentCloudAudio.pause(); URL.revokeObjectURL(this.currentCloudAudio.src); this.currentCloudAudio = null; }
            if (!this.voiceReply && window.speechSynthesis) window.speechSynthesis.cancel();
        },
        onVoiceNameChange() {
            saveConfig({ provider: this.provider, model: this.model, endpoint: this.endpoint, webSearch: this.webSearch, voiceReply: this.voiceReply, voiceName: this.voiceName });
        },
        _speak(msg) {
            if (!this.voiceReply) return;
            const text = msg.text;
            const clean = text
                .replace(/\[System:.*?\]/g, '')
                .replace(/—[^\n]*/g, '')
                .replace(/https?:\/\/\S+/g, '')
                .trim();
            if (!clean) return;

            // Stop any currently playing audio
            if (this.currentCloudAudio) {
                this.currentCloudAudio.pause();
                URL.revokeObjectURL(this.currentCloudAudio.src);
                this.currentCloudAudio = null;
            }
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            
            // Re-set all other messages to idle
            this.messages.forEach(m => { if (m.voiceState === 'playing' || m.voiceState === 'loading') m.voiceState = 'idle'; });

            if (this.voiceName && this.voiceName.startsWith('atlas_')) {
                // Cloud TTS via Edge Function
                let truncated = clean;
                if (truncated.length > 600) {
                    const match = truncated.substring(0, 600).match(/.*[.?!]/);
                    truncated = match ? match[0] : truncated.substring(0, 600);
                }
                
                msg.voiceState = 'loading';
                getSessionAsync().then(session => {
                    if (!session) throw new Error('Not signed in');
                    return fetch('https://vcndlorrrtueofzuynvi.supabase.co/functions/v1/atlas-tts-proxy', {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer ' + session.access_token,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ text: truncated, voice_profile: this.voiceName })
                    });
                }).then(res => {
                    if (!res.ok) throw new Error('Cloud TTS request failed');
                    return res.blob();
                }).then(blob => {
                    if (msg.voiceState === 'idle') return; // Cancelled mid-flight
                    msg.voiceState = 'playing';
                    const url = URL.createObjectURL(blob);
                    this.currentCloudAudio = new Audio(url);
                    this.currentCloudAudio.onended = () => { msg.voiceState = 'idle'; };
                    this.currentCloudAudio.onerror = () => { msg.voiceState = 'idle'; };
                    this.currentCloudAudio.play();
                }).catch(e => {
                    console.error('TTS proxy error:', e);
                    msg.voiceState = 'idle';
                    // Show a brief error toast, do not silently fallback to SpeechSynthesis
                    showUndoToast('Voice failed to load');
                });
            } else {
                // Browser fallback
                if (!window.speechSynthesis) return;
                msg.voiceState = 'playing';
                const utt = new SpeechSynthesisUtterance(clean);
                utt.rate = 1.0;
                utt.pitch = 1;
                if (this.voiceName) {
                    const voices = window.speechSynthesis.getVoices();
                    const match = voices.find(v => v.name === this.voiceName);
                    if (match) utt.voice = match;
                }
                utt.onend = () => { msg.voiceState = 'idle'; };
                utt.onerror = () => { msg.voiceState = 'idle'; };
                window.speechSynthesis.speak(utt);
            }
        },
        toggleAudio(msg) {
            if (msg.voiceState === 'playing' || msg.voiceState === 'loading') {
                if (this.currentCloudAudio) { this.currentCloudAudio.pause(); URL.revokeObjectURL(this.currentCloudAudio.src); this.currentCloudAudio = null; }
                if (window.speechSynthesis) window.speechSynthesis.cancel();
                msg.voiceState = 'idle';
            } else {
                this._speak(msg);
            }
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
            const msgId = 'msg_' + Date.now() + '_' + Math.floor(Math.random()*1000);
            const msg = { role: 'assistant', type: 'text', text, providerLabel: providerLabel || null, id: msgId, voiceState: 'idle' };
            this._pushMessage(msg);
            this._speak(msg);
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
                _pendingUseCaseExpiry = Date.now() + 90000; // 90-second window
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
            if (event.shiftKey) return;
            event.preventDefault();
            this.sendMessage();
        },

        // ---- Three-track routing ----
        // Track A: AI Memory save — client-side phrase detection, no model call, immediate confirm card.
        // Track B: Write-flow intent — parallel extraction call (JSON) + prose call (natural reply).
        // Track C: Normal chat — single prose call.
        async sendMessage() {
            const text = this.draft.trim();
            if (!text || this.thinking) return;
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            this._pushMessage({ role: 'user', type: 'text', text });
            this.draft = '';
            this.errorMsg = '';
            this.$nextTick(() => this.autoGrowComposer());

            // Auto-clear pendingUseCase if the 90-second window expired
            if (this.pendingUseCase && Date.now() > _pendingUseCaseExpiry) {
                this.pendingUseCase = null;
            }

            // pendingUseCase: explain_task -- one-turn task lookup, always clears after
            if (this.pendingUseCase === 'explain_task') {
                await this._handleTaskLookup(text);
                return;
            }

            // Track A: AI Memory save -- no model call needed
            if (this._isMemorySaveRequest(text)) {
                this._pushMemoryConfirmCard(text);
                // Removed return; to let the model generate a conversational reply
            }

            // Track B: Write-flow intent -- parallel extraction + prose
            const detectedIntent = this._detectIntent(text);
            if (detectedIntent) {
                await this._handleWriteIntent(text, detectedIntent);
                return;
            }

            // Track C: Normal chat
            await this._askModel(text, 'explain_day');
        },

        // Detects explicit "save to memory" requests client-side.
        // These bypass the model entirely and go to _pushMemoryConfirmCard().
        _isMemorySaveRequest(text) {
            const t = text.toLowerCase();
            if (/\bremember\s+(this|that)\b/.test(t)) return true;
            if (/\bnote\s+this\s+down\b/.test(t)) return true;
            if (/\b(save|store|note|add)\s+(this|that|it)\s+(to|in|into)\s+(your\s+)?(memory|notebook)\b/.test(t)) return true;
            if (/\b(save|add|note)\s+this\s+to\s+(your\s+)?memory\b/.test(t)) return true;
            if (/\b(save|store)\s+to\s+(your\s+)?(memory|notebook)\b/.test(t)) return true;
            return false;
        },

        // Pushes a confirm card for AI Memory save without any model call.
        // Strips the trigger phrase and uses the remainder as the memory entry.
        // Falls back to the last assistant response if no content remains.
        _pushMemoryConfirmCard(text) {
            let content = text
                .replace(/^(remember|save|store|note|add)\s+(this|that|it)\s+(to|in|into)\s+(your\s+)?(memory|notebook)\s*:?\s*/i, '')
                .replace(/^(save|add|note)\s+this\s+to\s+(your\s+)?memory\s*:?\s*/i, '')
                .replace(/^remember\s+(this|that)\s*:?\s*/i, '')
                .replace(/^note\s+this\s+down\s*:?\s*/i, '')
                .replace(/\s+to\s+(your\s+)?(memory|notebook)$/i, '')
                .trim();

            if (!content) {
                // User said "save this" with no payload -- use last assistant text
                const lastAssistant = [...this.messages].reverse().find(m => m.role === 'assistant' && m.type === 'text');
                content = lastAssistant ? lastAssistant.text.slice(0, 300) : text;
            }
            content = content.slice(0, 300);

            this._pushMessage({
                role: 'assistant',
                type: 'confirm',
                draft: {
                    title: 'Draft · Save to Memory Notebook',
                    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
                    fields: [{ k: 'Memory note', v: content }],
                    flowKey: 'save_ai_memory',
                    rawFields: { summary: content }
                },
                decided: null
            });
        },

        // Track B: fires extraction call and prose call in parallel.
        // Shows prose reply; if extraction returned usable fields, pushes confirm card below.
        async _handleWriteIntent(text, detectedIntent) {
            this.thinking = true;

            // For task/checklist: fetch task data first (needed in extraction context + caches)
            if (detectedIntent === 'complete_task' || detectedIntent === 'mark_checklist') {
                try {
                    const pkg = await buildFactPackage('explain_day');
                    if (pkg._taskList) _taskCache = pkg._taskList;
                    if (pkg._checklistItems) _checklistCache = pkg._checklistItems;
                    if (pkg._checklistDate != null) _checklistDate = pkg._checklistDate;
                } catch (e) { /* caches may be stale; handlers degrade gracefully */ }
            }

            const dynamicCtx = this._buildDynamicContext(detectedIntent);

            // Run both calls in parallel
            const results = await Promise.allSettled([
                this._extractFields(text, detectedIntent, dynamicCtx),
                this._callModelProse(text)
            ]);

            const extracted = results[0].status === 'fulfilled' ? results[0].value : null;
            const proseReply = results[1].status === 'fulfilled'
                ? results[1].value
                : 'Atlas AI is unavailable right now. Check the provider in Settings, or try the other one.';

            this._pushAssistantText(proseReply, this._currentProviderLabel());

            // Push confirm card if extraction succeeded
            if (extracted) {
                this._buildAndPushConfirmCard(extracted, detectedIntent);
            }

            this.thinking = false;
        },

        // Prose-only model call for Track B. Builds full system prompt (persona + facts + history)
        // but NO extraction instruction. Returns raw reply string; never throws -- returns an
        // error string instead so Track B can always display something.
        async _callModelProse(userText) {
            const pkg = await buildFactPackage('explain_day');
            // Update caches from the prose call's fact package (avoids a duplicate DB fetch)
            if (pkg._taskList) _taskCache = pkg._taskList;
            if (pkg._checklistItems) _checklistCache = pkg._checklistItems;
            if (pkg._checklistDate != null) _checklistDate = pkg._checklistDate;

            const notebookCtx = getNotebookContext();
            let systemPrompt = buildSystemPrompt(this.persona, notebookCtx);
            systemPrompt += '\n\n## FACTS AVAILABLE IF RELEVANT (do not mention these for a greeting or small talk)\n' + JSON.stringify(pkg.facts, null, 1);
            // No extraction instruction -- that goes in the separate extraction call

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
                    content = m.decided === 'saved'
                        ? '[' + m.draft.title + ' was confirmed and saved. That intent is complete.]'
                        : '[Draft was discarded -- nothing was saved.]';
                } else {
                    continue;
                }
                if (role === lastRole && apiMessages.length > 1) {
                    apiMessages[apiMessages.length - 1].content += '\n' + content;
                } else {
                    apiMessages.push({ role, content });
                    lastRole = role;
                }
            }
            apiMessages.push({ role: 'user', content: userText });

            const cfg = { provider: this.provider, model: this.model, endpoint: this.endpoint, webSearch: this.webSearch };
            return await sendToProvider(apiMessages, cfg);
        },

        // Extraction-only model call for Track B. Minimal context: schema + user message.
        // No persona, no history, no fact package. Returns parsed JSON object or null; never throws.
        async _extractFields(userText, detectedIntent, dynamicCtx) {
            try {
                const flow = WRITE_FLOWS[detectedIntent];
                if (!flow || !flow.extractionInstruction) return null;

                const systemContent = 'Extract structured data from the user message. Return ONLY valid JSON, no prose, no explanation, nothing else.\n' +
                    (dynamicCtx ? dynamicCtx + '\n' : '') +
                    flow.extractionInstruction;

                const cfg = { provider: this.provider, model: this.model, endpoint: this.endpoint, webSearch: false };
                const reply = await sendToProvider(
                    [{ role: 'system', content: systemContent }, { role: 'user', content: userText }],
                    cfg
                );

                // Parse JSON from reply
                let parsed = null;
                const raw = reply.trim();
                const fenceMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
                const cleanStr = fenceMatch ? fenceMatch[1].trim() : raw;
                try { parsed = JSON.parse(cleanStr); } catch (e) {
                    parsed = this._extractFirstJson(cleanStr);
                }
                return parsed;
            } catch (e) {
                return null; // Extraction failure is silently handled -- prose reply stands alone
            }
        },

        // Builds the numbered task/checklist list used in the extraction call context
        // for complete_task and mark_checklist. Empty string for other intents.
        _buildDynamicContext(detectedIntent) {
            if (detectedIntent === 'complete_task' && _taskCache && _taskCache.length) {
                return 'Current pending task list (1-based numbers):\n' +
                    _taskCache.map((t, i) => `${i + 1}. ${t.name}`).join('\n') + '\n';
            }
            if (detectedIntent === 'mark_checklist' && _checklistCache && _checklistCache.length) {
                const blockOrder = ['morning', 'afternoon', 'night', 'sleep'];
                const grouped = {};
                for (const c of _checklistCache) {
                    const bk = c.block || 'other';
                    if (!grouped[bk]) grouped[bk] = [];
                    grouped[bk].push(c);
                }
                let lines = "Today's routine checklist items (grouped by block, 1-based numbers within each block):\n";
                for (const bk of blockOrder) {
                    if (!grouped[bk] || !grouped[bk].length) continue;
                    lines += bk.charAt(0).toUpperCase() + bk.slice(1) + ':\n';
                    grouped[bk].forEach((c, i) => { lines += `  ${i + 1}. ${c.name}\n`; });
                }
                if (grouped['other'] && grouped['other'].length) {
                    lines += 'Other:\n';
                    grouped['other'].forEach((c, i) => { lines += `  ${i + 1}. ${c.name}\n`; });
                }
                return lines;
            }
            return '';
        },

        // Converts extraction output into a confirm card. Routes task/checklist through
        // their dedicated client-side resolution handlers; all others use the generic path.
        _buildAndPushConfirmCard(parsed, detectedIntent) {
            const intent = (parsed && parsed.intent) || detectedIntent;
            if (!intent || !WRITE_FLOWS[intent]) return;

            if (intent === 'complete_task') {
                this._handleTaskCompletion(parsed.fields || {}, this._currentProviderLabel());
                return;
            }
            if (intent === 'mark_checklist') {
                this._handleChecklistMarking(parsed.fields || {}, this._currentProviderLabel());
                return;
            }

            const flow = WRITE_FLOWS[intent];
            const fields = sanitizeDraftFields(intent, parsed.fields);
            if (!fields || Object.keys(fields).length === 0) return;

            const fieldRows = flow.fields
                .filter(f => fields[f.key] !== undefined)
                .map(f => ({ k: f.label, v: String(fields[f.key]) }));

            this._pushMessage({
                role: 'assistant',
                type: 'confirm',
                draft: { title: flow.title, icon: flow.icon, fields: fieldRows, flowKey: intent, rawFields: fields },
                decided: null
            });
        },

        // Task-name lookup for explain_task quick action (pendingUseCase).
        // Always clears pendingUseCase at the start, whether or not a match is found.
        async _handleTaskLookup(text) {
            this.pendingUseCase = null; // Always clear -- one attempt, then normal routing resumes
            this.thinking = true;
            try {
                const tasks = await DB.Tasks.listActive();
                const match = tasks.find(t => t.name.toLowerCase().includes(text.toLowerCase()));
                if (!match) {
                    this._pushAssistantText(`I couldn't find a task matching "${text}" -- try typing more of its exact name, or ask me anything else.`);
                    this.thinking = false;
                    return;
                }
                await this._askModel(`Break down the task "${match.name}" into 3-6 concrete sub-steps.`, 'explain_task', match.id);
            } catch (e) {
                this.thinking = false;
                this._pushAssistantText('Atlas AI is unavailable right now: ' + e.message);
            }
        },

        // Track C normal chat + explain_task breakdown. Pure prose, no extraction instruction.
        async _askModel(userText, factUseCase, entityId) {
            this.thinking = true;
            try {
                const pkg = await buildFactPackage(factUseCase, entityId);
                if (pkg._taskList) _taskCache = pkg._taskList;
                if (pkg._checklistItems) _checklistCache = pkg._checklistItems;
                if (pkg._checklistDate != null) _checklistDate = pkg._checklistDate;

                const notebookCtx = getNotebookContext();
                let systemPrompt = buildSystemPrompt(this.persona, notebookCtx);
                systemPrompt += '\n\n## FACTS AVAILABLE IF RELEVANT (do not mention these for a greeting or small talk)\n' + JSON.stringify(pkg.facts, null, 1);
                // No extraction instruction in Track C -- extraction is only for Track B's parallel call

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
                        content = m.decided === 'saved'
                            ? '[' + m.draft.title + ' was confirmed and saved. That intent is complete.]'
                            : '[Draft was discarded -- nothing was saved.]';
                    } else {
                        continue;
                    }
                    if (role === lastRole && apiMessages.length > 1) {
                        apiMessages[apiMessages.length - 1].content += '\n' + content;
                    } else {
                        apiMessages.push({ role, content });
                        lastRole = role;
                    }
                }
                apiMessages.push({ role: 'user', content: userText });

                const cfg = { provider: this.provider, model: this.model, endpoint: this.endpoint, webSearch: this.webSearch };
                const reply = await sendToProvider(apiMessages, cfg);
                this._pushAssistantText(reply, this._currentProviderLabel());
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

        // Client-side intent classifier. Determines which write flow (if any) a message
        // belongs to, before any model call. Only handles the five model-backed flows;
        // save_ai_memory is handled upstream by _isMemorySaveRequest().
        _detectIntent(text) {
            const t = text.toLowerCase();
            const w = /\b(workout|exercise|training|cardio|strength|calories|gym|leg\s*day|push\s*day|pull\s*day|run(ning)?|jog(ging)?|swim(ming)?|cycling|lift(ing)?|weights?|squats?|deadlifts?|bench|hiit|yoga|burned|reps|sets|treadmill|session|went\s+to\s+(the\s+)?gym|personal\s+record|PR\b|vo2)\b/.test(t);
            const s = /\b(sle(ep|pt)|nap(ped)?|sleep\s*score|deep\s*sleep|rem\b|resting\s*(heart\s*rate|hr)|hrv|heart\s*rate\s*variability|woke\s*up|bed\s*time|hours?\s+(of\s+)?sleep|fell\s+asleep|night\s+was|slept\s+(well|poorly|badly|great))\b/.test(t);
            if (w && !s) return 'log_workout';
            if (s && !w) return 'log_sleep';
            // Task completion: clear "task is done" language
            if (/\btask\b/.test(t) && /\b(done|finish(ed)?|complet(e|ed)?|mark(ed)?(\s+done)?)\b/.test(t)) return 'complete_task';
            if (/\b(finish(ed)?|complet(e|ed)?|done\s+with|knocked?\s+out)\b/.test(t) && /\btask\b/.test(t)) return 'complete_task';
            // Checklist marking
            if (/\bmark\b/.test(t) && /\b(checklist|routine|morning|afternoon|night|items?)\b/.test(t)) return 'mark_checklist';
            if (/\bskipped?\b/.test(t) && !w && !s) return 'mark_checklist';
            if (/\bi\s+(did|completed|finished)\b/.test(t) && !/\btask\b/.test(t) && !w && !s) return 'mark_checklist';
            // Journal: emotional/reflective language
            if (/\b(felt|feeling|i\s+feel)\b/.test(t)) return 'journal_reflection';
            if (/\btoday\s+(was|felt|went)\b/.test(t)) return 'journal_reflection';
            if (/\b(rough|good|great|bad|hard|tough)\s+day\b/.test(t)) return 'journal_reflection';
            if (/\b(mark|write|log)\s+(my\s+)?journal\b/.test(t)) return 'journal_reflection';
            if (/\b(had\s+a\s+moment|want\s+to\s+note|reflecting\s+on|i\s+want\s+to\s+write)\b/.test(t)) return 'journal_reflection';
            if (/\bi(?:'m|\s+am)\s+(proud|grateful|anxious|tired|happy|sad|frustrated|excited|worried|stressed|calm|confident|overwhelmed|relieved|energised?|drained|exhausted|burnt\s*out|motivated|depressed|lonely|content|hopeful|irritated)\b/.test(t)) return 'journal_reflection';
            return null;
        },

        // Resolves a task-completion intent against the cached task list.
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
            const blockOrder = ['morning', 'afternoon', 'night', 'sleep'];
            const byBlock = {};
            for (const c of _checklistCache) {
                const bk = c.block || 'other';
                if (!byBlock[bk]) byBlock[bk] = [];
                byBlock[bk].push(c);
            }
            const resolved = [];
            const unresolved = [];
            for (const item of fields.items) {
                let match = null;
                if (item.block && item.number != null) {
                    const bk = item.block.toLowerCase();
                    const idx = Math.round(Number(item.number)) - 1;
                    if (byBlock[bk] && idx >= 0 && idx < byBlock[bk].length) match = byBlock[bk][idx];
                }
                if (!match && item.number != null && !item.block) {
                    const idx = Math.round(Number(item.number)) - 1;
                    if (idx >= 0 && idx < _checklistCache.length) match = _checklistCache[idx];
                }
                if (!match && item.name) {
                    const needle = normalize(item.name);
                    match = _checklistCache.find(c => normalize(c.name) === needle);
                }
                if (match) {
                    resolved.push({ id: match.id, name: match.name, status: item.status === 'skipped' ? 'skipped' : 'done', note: item.note || null });
                } else {
                    unresolved.push(item.name || (item.block ? item.block + ' #' + item.number : '#' + item.number) || '?');
                }
            }
            if (unresolved.length > 0) {
                const blockLines = [];
                for (const bk of blockOrder) {
                    if (!byBlock[bk] || !byBlock[bk].length) continue;
                    blockLines.push(bk.charAt(0).toUpperCase() + bk.slice(1) + ':');
                    byBlock[bk].forEach((c, i) => blockLines.push(`  ${i + 1}. ${c.name}`));
                }
                this._pushAssistantText(
                    `I couldn't match: ${unresolved.map(n => '"' + n + '"').join(', ')}. Nothing was marked.\n\nYour routine items today:\n${blockLines.join('\n')}\n\nTry again using block + number (e.g. "morning 2") or exact names.`,
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
            const count = resolved.length;
        },

        async confirmDraft(msg) {
            const flowKey = msg.draft.flowKey;
            const flow = WRITE_FLOWS[flowKey];
            if (!flow && flowKey !== 'save_ai_memory') return;
            try {
                if (flowKey === 'save_ai_memory') {
                    // AI Memory: local write (sync) → verify → awaited cloud push
                    const summary = msg.draft.rawFields.summary;
                    this._addNotebookEntry('memory', summary);
                    // Verify local write landed in the reactive array
                    if (!this.notebookEntries.length || this.notebookEntries[0].text !== summary) {
                        throw new Error('Memory entry could not be confirmed locally');
                    }
                    // Await the cloud push (not fire-and-forget for AI Memory)
                    await pushNotebook(this.notebookEntries);
                } else {
                    // All other flows: write is verified inside flow.write() (uses verifiedInsert/Update)
                    await flow.write(msg.draft.rawFields);
                    // Dispatch cross-component refresh event so Today page panels update without reload
                    if (flowKey === 'log_workout' || flowKey === 'log_sleep' ||
                        flowKey === 'complete_task' || flowKey === 'mark_checklist') {
                        window.dispatchEvent(new CustomEvent('atlas:data-changed', { detail: { source: flowKey } }));
                    }
                }
                msg.decided = 'saved';
                if (flowKey === 'save_ai_memory') {
                    // Auto-switch to notebook so the user sees the new entry immediately
                    this.view = 'notebook';
                    this._pushAssistantText('Saved to your Memory Notebook.');
                }
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
            this.notebookEntries = [{ type: 'compact', date: `covers ${first.date}--${last.date}`, text: summary }];
            saveNotebookLocal(this.notebookEntries);
            pushNotebook(this.notebookEntries);
        },

        _addNotebookEntry(type, text) {
            this.notebookEntries.unshift({ type, date: dayLabel(todayIsoDate()) === 'Today' ? new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : todayIsoDate(), text });
            saveNotebookLocal(this.notebookEntries);
            pushNotebook(this.notebookEntries); // fire-and-forget for pin/session/compact; confirmDraft awaits separately for save_ai_memory
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
        reloadPersona() {
            this.persona = loadPersona();
        }
    };
}
