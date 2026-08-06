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
import { getSession } from '../auth.js';
import { todayIsoDate } from '../date-utils.js';
import { askConfirm } from '../components/confirm-dialog.js';
import { showUndoToast } from '../components/undo-toast.js';
import {
    loadConfig, saveConfig, loadPersona, savePersona,
    hasPin as pinExists, setPin, checkPin, clearPin,
    loadChatHistory, saveChatHistory, clearChatHistory, pushChatHistory, pullChatHistory, chatSyncStatus,
    loadNotebookLocal, saveNotebookLocal, pushNotebook, pullNotebook,
    sendToProvider, buildSystemPrompt, getNotebookContext
} from '../features/aiConfig.js';
import { buildFactPackage, WRITE_FLOWS, sanitizeDraftFields } from '../features/aiContext.js';
import {
    CONVERSATIONAL_ACTIONS, detectActionStart, resolveAmbiguous, newDraft,
    mergeExtractedFields, firstMissingField, markSkipped, isCancelPhrase,
    isDeclineAnswer, isYes, isNo, formatReadBack, draftToCardFields, draftToRawFields
} from '../features/conversationalActions.js';

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

// Voice capture state -- module-level, not reactive (avoids Alpine proxy
// issues with browser API objects). MediaRecorder-based since 2026-08-08
// (see toggleVoice() for why) -- these replace the old speechRecognition var.
let _mediaRecorder = null;
let _mediaStream = null;
let _mediaChunks = [];
let _recordingWatchdog = null;
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
        // Reactive mirror of the chat-sync push state -- polled once every
        // few seconds while the panel is open (see init()) so the header
        // sync-status dot can turn coral if a push has failed. The status
        // itself lives in aiConfig.js's module-level push queue; this is
        // just a UI cache of it.
        syncOk: true,

        // Conversational Actions (voice-first logging & creation, approved
        // 2026-08-07 -- see PLAN.md's "NEXT UP" section / CLAUDE.md). One
        // running draft lives here across every turn until saved or
        // cancelled; _pendingActionChoice holds a disambiguation shortlist
        // when a message matched more than one action's trigger.
        activeAction: null,
        _pendingActionChoice: null,

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
                    { name: 'atlas_calm', lang: 'Indian English', label: 'Atlas Calm' },
                    { name: 'atlas_clear', lang: 'Global English', label: 'Atlas Clear' }
                ];
                const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
                const currentName = this.voiceName;
                this.voiceList = [
                    ...cloudVoices,
                    ...(voices.length ? voices.map(v => ({ name: v.name, lang: v.lang, label: v.name })) : [])
                ];
                if (this.$nextTick) {
                    this.$nextTick(() => { this.voiceName = currentName; });
                }
            };
            loadVoices();
            if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;
            this.hasPin = pinExists();
            this.messages = loadChatHistory();
            pullChatHistory().then(messages => { if (messages) { this.messages = messages; this.$nextTick(() => this._scrollToBottom()); } });
            this.notebookEntries = loadNotebookLocal();
            pullNotebook().then(() => { this.notebookEntries = loadNotebookLocal(); });

            // Poll the chat-sync push status every 3s -- cheap enough (in-
            // memory read, no network) and low-frequency enough that the
            // dot latency is negligible. Doesn't run when the panel is
            // closed (guarded by panelOpen).
            setInterval(() => {
                if (!this.panelOpen) return;
                const s = chatSyncStatus();
                this.syncOk = s.ok;
            }, 3000);

            // Lets any page open the panel pre-loaded with a specific topic
            // (e.g. the Today insight ticker) without either side reaching
            // into the other's Alpine scope -- same decoupled CustomEvent
            // pattern as atlas:data-changed. Pre-fills the composer and
            // focuses it; never auto-sends, so the user still chooses to
            // start the conversation.
            window.addEventListener('atlas:ask-ai', (e) => {
                this.view = 'chat';
                this.draft = (e.detail && e.detail.text) || '';
                this.openPanel();
                this.$nextTick(() => this.$refs.composerEl && this.$refs.composerEl.focus());
            });
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
                // Markdown formatting characters -- the model's reply is
                // rendered as markdown on-screen but must be spoken as plain
                // sentences, not have "asterisk asterisk" etc. read aloud.
                .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
                .replace(/\*\*(.*?)\*\*/g, '$1')
                .replace(/\*(.*?)\*/g, '$1')
                .replace(/_{1,2}([^_]*)_{1,2}/g, '$1')
                .replace(/^#{1,6}\s+/gm, '')
                .replace(/^\s*[-*•]\s+/gm, '')
                .replace(/^\s*\d+\.\s+/gm, '')
                // Em dash is a pause in speech, not a delete-to-end-of-line marker.
                // The old version here (/—[^\n]*/g) removed the dash AND every
                // character after it up to the next newline -- since the model
                // routinely uses an em dash mid-sentence, including in closing
                // lines, this was silently amputating the rest of the reply
                // (confirmed live, 2026-07-31 correction pass -- a known,
                // previously-flagged, never-fixed gap from the 2026-07-29 audit).
                // Replacing just the dash itself with a comma-like pause keeps
                // every word of the actual reply intact.
                .replace(/\s*—\s*/g, ', ')
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
                // Cloud TTS via Edge Function -- send the full cleaned reply.
                // No client-side truncation: the server is the single source
                // of truth on whether/how a reply gets cut (its hard limit is
                // well above what Google's TTS API itself accepts), and it
                // reports back via the X-Voice-Truncated header so the UI
                // hint always reflects what actually happened, not a guess.
                msg.voiceTruncated = false;

                msg.voiceState = 'loading';
                const session = getSession();
                if (!session) {
                    msg.voiceState = 'idle';
                    showUndoToast('Voice failed to load (Not signed in)');
                    return;
                }

                fetch('https://vcndlorrrtueofzuynvi.supabase.co/functions/v1/atlas-tts-proxy', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + session.access_token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ text: clean, voice_profile: this.voiceName })
                }).then(res => {
                    if (!res.ok) throw new Error('Cloud TTS request failed');
                    msg.voiceTruncated = res.headers.get('X-Voice-Truncated') === 'true';
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
            // createdAt is the sort key mergeChatMessages() uses when
            // reconciling cross-device pulls -- without it, a message
            // typed on device A after a pull from device B could reorder
            // out of insertion order after a merge (older messages
            // wouldn't sort correctly against newer ones with no clock).
            this.messages.push(Object.assign({ id: crypto.randomUUID(), date: todayIsoDate(), time: nowLabel(), createdAt: Date.now() }, msg));
            this._persistChatHistory();
            this.$nextTick(() => this._scrollToBottom());
        },
        // Local save (fast path, always) + fire-and-forget cloud push (added
        // 2026-08-08 for cross-device sync) -- every mutation point that used
        // to call saveChatHistory() directly now goes through this instead.
        _persistChatHistory() {
            saveChatHistory(this.messages);
            pushChatHistory(this.messages);
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
            else if (useCase === 'explain_health') {
                // Bypasses sendMessage()'s text-based routing entirely (same
                // reasoning as explain_task below) so this button is never
                // dependent on phrase-matching drift -- it always reaches a
                // real 14-day history package, not explain_day.
                const text = 'Give me a health check-in';
                this._pushMessage({ role: 'user', type: 'text', text });
                const today = todayIsoDate();
                const start = new Date(today + 'T00:00:00');
                start.setDate(start.getDate() - 13);
                const range = { startDate: start.toLocaleDateString('en-CA'), endDate: today, label: 'last 14 days', compare: false };
                this._askModel(text, 'explain_history', null, range);
            }
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

        // ---- Four-track routing ----
        // Track D: Conversational Action — multi-turn draft (log sleep/workout, create task/reminder). Checked first: an
        //          active draft or a pending disambiguation captures every subsequent message until saved/cancelled.
        // Track A: AI Memory save — client-side phrase detection, no model call, immediate confirm card.
        // Track B: Write-flow intent — parallel extraction call (JSON) + prose call (natural reply). (complete_task/mark_checklist/journal_reflection only -- log_sleep/log_workout moved to Track D.)
        // Track C: Normal chat — single prose call.
        async sendMessage() {
            const text = this.draft.trim();
            if (!text || this.thinking) return;
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            this._pushMessage({ role: 'user', type: 'text', text });
            this.draft = '';
            this.errorMsg = '';
            this.$nextTick(() => this.autoGrowComposer());

            // Track D, in progress: every message goes to the active draft until it's saved or cancelled.
            if (this.activeAction) {
                if (isCancelPhrase(text)) {
                    this.activeAction = null;
                    this._pushAssistantText("Okay, cancelled — nothing was saved.");
                    return;
                }
                await this._continueConversationalAction(text);
                return;
            }
            // Track D, disambiguation follow-up ("did you mean sleep or workout?")
            if (this._pendingActionChoice) {
                const resolved = resolveAmbiguous(text, this._pendingActionChoice);
                if (resolved) {
                    this._pendingActionChoice = null;
                    await this._startConversationalAction(resolved, text);
                } else {
                    this._pushAssistantText(`Sorry, I still couldn't tell -- ${this._pendingActionChoice.map(k => CONVERSATIONAL_ACTIONS[k].label).join(' or ')}?`);
                }
                return;
            }

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

            // Track D, start: deterministic trigger match, checked before Track B/C so a natural
            // "log my sleep" / "add a task" always opens a real conversation instead of falling
            // through to plain chat or a one-shot extraction.
            const startMatch = detectActionStart(text);
            if (startMatch) {
                if (startMatch.ambiguous) {
                    this._pendingActionChoice = startMatch.ambiguous;
                    this._pushAssistantText(`Did you mean ${startMatch.ambiguous.map(k => CONVERSATIONAL_ACTIONS[k].label).join(' or ')}?`);
                } else {
                    await this._startConversationalAction(startMatch.action, text);
                }
                return;
            }

            // Track B: Write-flow intent -- parallel extraction + prose
            const detectedIntent = this._detectIntent(text);
            if (detectedIntent) {
                await this._handleWriteIntent(text, detectedIntent);
                return;
            }

            // Track C: Normal chat -- route to a date-range package when the
            // message asks about a past day/week/pattern or a future
            // plan/workload; otherwise stay on today-only.
            const histRange = this._detectHistoryRange(text);
            if (histRange) await this._askModel(text, 'explain_history', null, histRange);
            else await this._askModel(text, 'explain_day');
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
            if (detectedIntent === 'complete_task' || detectedIntent === 'mark_checklist' ||
                detectedIntent === 'start_task' || detectedIntent === 'pause_task' || detectedIntent === 'delete_task') {
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

        // ---- Track D: Conversational Actions ----
        // The running draft (this.activeAction) is the actual fix for the old
        // single-shot bug: every message here is judged in the context of
        // what was already said, not judged alone. Missing-field detection,
        // skip handling, and the final yes/no are all decided deterministically
        // in conversationalActions.js -- the model is only ever asked to pull
        // field values out of a sentence, never to decide what happens next.

        async _startConversationalAction(actionKey, seedText) {
            this.thinking = true;
            const draft = newDraft(actionKey);
            const extracted = await this._extractActionFields(draft, seedText, null);
            mergeExtractedFields(draft, extracted);
            this.activeAction = draft;
            this.thinking = false;
            this._advanceConversationalAction();
        },

        async _continueConversationalAction(text) {
            const draft = this.activeAction;

            if (draft.awaitingConfirm) {
                // Safety-critical: only ever save on an UNAMBIGUOUS yes. If the
                // reply matches both patterns ("no wait, yes") or neither, treat
                // it as unclear and re-ask rather than guess -- a misheard word
                // must never be able to produce a wrong write (see CLAUDE.md).
                const yes = isYes(text), no = isNo(text);
                if (yes && !no) {
                    const msg = this.messages.find(m => m.id === draft._confirmMsgId);
                    if (msg && !msg.decided) await this.confirmDraft(msg);
                    return;
                }
                if (no && !yes) {
                    const msg = this.messages.find(m => m.id === draft._confirmMsgId);
                    if (msg && !msg.decided) this.cancelDraft(msg);
                    this._pushAssistantText("Okay, discarded. Say it again whenever you're ready.");
                    return;
                }
                this._pushAssistantText("Sorry, just to be safe -- was that a clear yes to save, or no?");
                return;
            }

            const action = CONVERSATIONAL_ACTIONS[draft.action];
            const field = draft.awaitingField ? action.fields.find(f => f.key === draft.awaitingField) : null;

            if (field && isDeclineAnswer(text)) {
                if (field.required) {
                    this._pushAssistantText(`I do need that one -- ${field.question}`);
                    return;
                }
                markSkipped(draft, field.key);
                this._advanceConversationalAction();
                return;
            }

            this.thinking = true;
            const extracted = await this._extractActionFields(draft, text, field ? field.key : null);
            mergeExtractedFields(draft, extracted);
            this.thinking = false;
            this._advanceConversationalAction();
        },

        // Deterministic (no model call): decide whether another field is worth
        // asking about, or whether every ask-worthy field is filled/skipped and
        // it's time for the read-back-and-confirm.
        _advanceConversationalAction() {
            const draft = this.activeAction;
            const field = firstMissingField(draft);
            if (field) {
                draft.awaitingField = field.key;
                draft.awaitingConfirm = false;
                this._pushAssistantText(field.question);
                return;
            }
            draft.awaitingField = null;
            draft.awaitingConfirm = true;
            const action = CONVERSATIONAL_ACTIONS[draft.action];
            const msgId = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            draft._confirmMsgId = msgId;
            this._pushMessage({
                id: msgId,
                role: 'assistant',
                type: 'confirm',
                draft: { title: action.cardTitle, icon: action.icon, fields: draftToCardFields(draft), flowKey: '__conv:' + draft.action, rawFields: draftToRawFields(draft) },
                decided: null
            });
            // Speak the read-back even though it isn't its own chat bubble --
            // the confirm card is the visual record, this is what a voice
            // conversation actually hears before saying yes/no.
            this._speak({ text: formatReadBack(draft), voiceState: 'idle' });
        },

        // Extraction-only model call for Track D. Minimal, scoped to the
        // active action's own field schema -- same "no persona, no history"
        // isolation as Track B's _extractFields, so it can't be pulled toward
        // prose or contaminated by unrelated conversation.
        async _extractActionFields(draft, userText, currentFieldKey) {
            try {
                const action = CONVERSATIONAL_ACTIONS[draft.action];
                const todayCtx = `Today's date is ${todayIsoDate()} (${new Date().toLocaleDateString('en-US', { weekday: 'long' })}).`;
                const fieldDocs = action.fields.map(f => `"${f.key}": ${f.extractHint}`).join('\n');
                const schemaKeys = action.fields.map(f => `"${f.key}":${f.type === 'number' ? 'number|null' : 'string|null'}`).join(',');
                const focusHint = currentFieldKey ? `The user was just asked specifically about "${currentFieldKey}". If their reply is a bare value with no other context, it belongs there.` : '';
                // create_task/create_reminder have a "project" field -- give the
                // model the real, current project names so a loose spoken match
                // ("the Atlas one") has a real list to resolve against, instead
                // of guessing at a name resolveProjectId() then can't match.
                let projectHint = '';
                if (action.fields.some(f => f.key === 'project')) {
                    try {
                        const projects = await DB.Projects.listActive();
                        if (projects.length) projectHint = `\nHis current projects (match "project" against these names if he references one, even loosely -- e.g. "the Atlas one" -> the closest name below): ${projects.map(p => p.name).join(', ')}`;
                    } catch (e) { /* project list is a nice-to-have for extraction; degrade quietly */ }
                }
                // Deliberately does NOT ask the model to report "declined" fields
                // anymore -- that was a real bug (2026-08-08): the model could
                // silently mark a field skipped on its own judgment, which is
                // exactly the "let the model decide what happens next" failure
                // mode this whole mechanism exists to avoid. A field is now
                // ONLY ever skipped by the user's own literal decline answer to
                // the specific question asked about it (see isDeclineAnswer()
                // in conversationalActions.js) -- extraction here only ever
                // fills in values, never removes the need to ask about one.
                const systemContent = `Extract structured data from the user's message for a ${action.label} entry. Return ONLY valid JSON, no prose: {${schemaKeys}}\n${todayCtx}\nField meanings:\n${fieldDocs}\n${focusHint}${projectHint}\nDates must resolve to YYYY-MM-DD, times to 24-hour HH:MM. Use null for anything not mentioned. Do not invent values.`;
                const cfg = { provider: this.provider, model: this.model, endpoint: this.endpoint, webSearch: false };
                const reply = await sendToProvider([{ role: 'system', content: systemContent }, { role: 'user', content: userText }], cfg);
                return this._parseJsonReply(reply);
            } catch (e) {
                return null;
            }
        },

        _parseJsonReply(reply) {
            const raw = reply.trim();
            const fenceMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
            const cleanStr = fenceMatch ? fenceMatch[1].trim() : raw;
            try { return JSON.parse(cleanStr); } catch (e) { return this._extractFirstJson(cleanStr); }
        },

        // Prose-only model call for Track B. Builds full system prompt (persona + facts + history)
        // but NO extraction instruction. Returns raw reply string; never throws -- returns an
        // error string instead so Track B can always display something.
        async _callModelProse(userText) {
            // Write-intent messages occasionally carry history/comparison
            // language too ("that leg day was better than last week's") --
            // give the prose reply real numbers when that's the case. The
            // parallel extraction call (_extractFields) is untouched, it
            // only ever needs the narrow write-flow schema.
            const histRange = this._detectHistoryRange(userText);
            const pkg = histRange
                ? await buildFactPackage('explain_history', null, histRange)
                : await buildFactPackage('explain_day');
            this._logFactPackage(pkg);
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

                return this._parseJsonReply(reply);
            } catch (e) {
                return null; // Extraction failure is silently handled -- prose reply stands alone
            }
        },

        // Builds the numbered task/checklist list used in the extraction call context
        // for complete_task and mark_checklist. Empty string for other intents.
        _buildDynamicContext(detectedIntent) {
            if ((detectedIntent === 'complete_task' || detectedIntent === 'start_task' || detectedIntent === 'pause_task' || detectedIntent === 'delete_task') && _taskCache && _taskCache.length) {
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
            if (intent === 'start_task') {
                this._handleTaskLifecycleAction(parsed.fields || {}, this._currentProviderLabel(), {
                    flowKey: 'start_task', title: 'Draft · Start task',
                    icon: WRITE_FLOWS.start_task.icon, extraRawFields: { note: parsed.fields && parsed.fields.note || null }
                });
                return;
            }
            if (intent === 'pause_task') {
                this._handleTaskLifecycleAction(parsed.fields || {}, this._currentProviderLabel(), {
                    flowKey: 'pause_task', title: 'Draft · Pause task',
                    icon: WRITE_FLOWS.pause_task.icon, extraRawFields: { reason: parsed.fields && parsed.fields.reason || null },
                    extraCardField: parsed.fields && parsed.fields.reason ? { k: 'Reason', v: parsed.fields.reason } : null
                });
                return;
            }
            if (intent === 'delete_task') {
                this._handleTaskLifecycleAction(parsed.fields || {}, this._currentProviderLabel(), {
                    flowKey: 'delete_task', title: 'Draft · Delete task',
                    icon: WRITE_FLOWS.delete_task.icon
                });
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
        async _askModel(userText, factUseCase, entityId, rangeOpts) {
            this.thinking = true;
            try {
                const pkg = await buildFactPackage(factUseCase, entityId, rangeOpts);
                this._logFactPackage(pkg);
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

        // Dev visibility into exactly what the model was given for a given
        // question. Always prints a one-line summary; full JSON payload only
        // behind a debug flag so normal use stays quiet.
        // Toggle with: localStorage.setItem('atlas_ai_debug','1')
        _logFactPackage(pkg) {
            const counts = pkg._counts ? Object.entries(pkg._counts).map(([k, v]) => `${k}=${v}`).join(' ') : '';
            console.log(`[Atlas AI] fact package · useCase=${pkg.useCase}${pkg._rangeLabel ? ' · range=' + pkg._rangeLabel : ''}${counts ? ' · ' + counts : ''}`);
            if (localStorage.getItem('atlas_ai_debug') === '1') {
                console.group('[Atlas AI] full facts payload (' + pkg.useCase + ')');
                console.log(JSON.stringify(pkg.facts, null, 2));
                console.groupEnd();
            }
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

        // Deterministic date-range phrase detector for Track C/B (no second model
        // call, same style as _detectIntent below). Returns
        // {startDate, endDate, label, compare} or null -- null means "stay on
        // today-only" (explain_day). Covers both past phrasing ("last week",
        // "yesterday") and future phrasing ("next week", "next 10 days", a
        // named month) since Atlas's Calendar/history pipeline is a single
        // past+future timeline, not two separate systems.
        _detectHistoryRange(text) {
            const t = text.toLowerCase();
            const today = todayIsoDate();
            const addDays = (d, n) => {
                const dt = new Date(d + 'T00:00:00');
                dt.setDate(dt.getDate() + n);
                return dt.toLocaleDateString('en-CA');
            };
            const wantsCompare = /\b(vs\.?|versus|compare[d]?\s+to|relative\s+to|compared\s+with)\b/.test(t);

            // "last N days"
            let m = t.match(/\blast\s+(\d{1,3})\s+days?\b/);
            if (m) {
                const n = Math.min(90, Math.max(1, parseInt(m[1], 10)));
                return { startDate: addDays(today, -(n - 1)), endDate: today, label: `last ${n} days`, compare: false };
            }
            // "next N days"
            m = t.match(/\bnext\s+(\d{1,3})\s+days?\b/);
            if (m) {
                const n = Math.min(90, Math.max(1, parseInt(m[1], 10)));
                return { startDate: today, endDate: addDays(today, n - 1), label: `next ${n} days`, compare: false };
            }

            if (/\byesterday\b|\blast\s+night\b/.test(t)) {
                const y = addDays(today, -1);
                return { startDate: y, endDate: y, label: 'yesterday', compare: false };
            }

            // Named month ("show me my plan for August"), optionally with a year.
            const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
            m = t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b(?:\s+(\d{4}))?/);
            if (m) {
                const monthIdx = MONTHS.indexOf(m[1]);
                const now = new Date(today + 'T00:00:00');
                let year = m[2] ? parseInt(m[2], 10) : now.getFullYear();
                if (!m[2] && monthIdx < now.getMonth()) year += 1; // named month already passed this year -- assume next year
                const first = new Date(year, monthIdx, 1);
                const last = new Date(year, monthIdx + 1, 0);
                const fmt = d => d.toLocaleDateString('en-CA');
                return { startDate: fmt(first), endDate: fmt(last), label: `${m[1][0].toUpperCase() + m[1].slice(1)} ${year}`, compare: false };
            }

            if (/\bnext\s+week\b/.test(t)) {
                return { startDate: addDays(today, 7), endDate: addDays(today, 13), label: 'next week', compare: wantsCompare };
            }
            const thisVsLastWeek = /\bthis\s+week\b[\s\S]*\blast\s+week\b|\blast\s+week\b[\s\S]*\bthis\s+week\b/.test(t);
            if (thisVsLastWeek || (wantsCompare && /\bweek\b/.test(t) && !/\bnext\s+week\b/.test(t))) {
                return { startDate: addDays(today, -6), endDate: today, label: 'this week vs last week', compare: true };
            }
            if (wantsCompare && /\bmonth\b/.test(t) && !/\bnext\s+month\b/.test(t)) {
                return { startDate: addDays(today, -29), endDate: today, label: 'this month vs last month', compare: true };
            }
            if (/\bthis\s+week\b/.test(t)) {
                return { startDate: today, endDate: addDays(today, 6), label: 'this week', compare: false };
            }
            if (/\blast\s+week\b|\bpast\s+week\b/.test(t)) {
                return { startDate: addDays(today, -6), endDate: today, label: 'last 7 days', compare: false };
            }
            if (/\bnext\s+month\b/.test(t)) {
                return { startDate: addDays(today, 1), endDate: addDays(today, 30), label: 'next 30 days', compare: false };
            }
            if (/\blast\s+month\b|\bpast\s+month\b/.test(t)) {
                return { startDate: addDays(today, -29), endDate: today, label: 'last 30 days', compare: false };
            }
            if (/\bhealth\s+check[\s-]?in\b/.test(t)) {
                return { startDate: addDays(today, -13), endDate: today, label: 'last 14 days', compare: false };
            }
            if (/\b(pattern|trend|lately|recently|over\s+time)\b/.test(t) || /\bhow\s+(have|has|i)\s+.*been\b/.test(t)) {
                return { startDate: addDays(today, -13), endDate: today, label: 'last 14 days', compare: false };
            }
            if (/\b(coming\s+up|upcoming|what.?s\s+(planned|on\s+my\s+plate|ahead))\b/.test(t)) {
                return { startDate: today, endDate: addDays(today, 9), label: 'next 10 days', compare: false };
            }
            if (/\b(last|past)\s+(two|2|three|3|couple(\s+of)?)\s+(workouts?|sessions?|nights?|days?)\b/.test(t)) {
                return { startDate: addDays(today, -9), endDate: today, label: 'recent activity', compare: false };
            }

            // Fallback: a bare sleep/workout/health topic word with no range
            // language at all ("check my sleep data", "how's my sleep",
            // "what about my workouts") -- confirmed live 2026-07-29 that
            // without this, these fall through to explain_day, which carries
            // zero health fields by design, and a weak local model fills the
            // gap with hallucinated placeholder text instead of admitting it
            // has nothing. Defaults to the same 14-day window the "Health
            // check-in" quick action already uses.
            if (/\b(sle(ep|pt|eping)|nap(ped)?|deep\s*sleep|rem\b|resting\s*(heart\s*rate|hr)|hrv|heart\s*rate\s*variability|woke\s*up|bed\s*time|workout|exercise|training|cardio|gym|health)\b/.test(t)) {
                return { startDate: addDays(today, -13), endDate: today, label: 'last 14 days', compare: false };
            }

            return null;
        },

        // Client-side intent classifier. Determines which write flow (if any) a message
        // belongs to, before any model call. log_workout/log_sleep moved to Track D
        // (Conversational Actions, see detectActionStart() in conversationalActions.js) --
        // this now only covers the three flows Track D doesn't own; save_ai_memory is
        // handled upstream by _isMemorySaveRequest().
        _detectIntent(text) {
            const t = text.toLowerCase();
            // Task/reminder lifecycle -- start/pause/delete checked BEFORE the
            // generic completion check below, since a message like "pause
            // task 2, I'm done for now" contains "done" but isn't a
            // completion. Reminders resolve through the exact same
            // _taskCache/_resolveTaskFromFields path as tasks throughout --
            // confirmed live 2026-08-08 that "reminder"-only wording used to
            // fall through to plain chat and get wrongly denied.
            if (/\b(delete|remove|discard)\b/.test(t) && /\b(task|reminder)\b/.test(t)) return 'delete_task';
            if (/\b(pause|hold\s+off\s+on|put\s+.*\bon\s+hold)\b/.test(t) && /\b(task|reminder)\b/.test(t)) return 'pause_task';
            if (/\b(start|resume|begin|continue)\b/.test(t) && /\b(task|reminder)\b/.test(t)) return 'start_task';
            // Task/reminder completion: clear "done" language.
            if (/\b(task|reminder)\b/.test(t) && /\b(done|finish(ed)?|complet(e|ed)?|mark(ed)?(\s+done)?)\b/.test(t)) return 'complete_task';
            if (/\b(finish(ed)?|complet(e|ed)?|done\s+with|knocked?\s+out)\b/.test(t) && /\b(task|reminder)\b/.test(t)) return 'complete_task';
            // Checklist marking
            if (/\bmark\b/.test(t) && /\b(checklist|routine|morning|afternoon|night|items?)\b/.test(t)) return 'mark_checklist';
            // !w && !s no longer needed here -- Track D's detectActionStart() already
            // ran first and returned null, so neither pattern matched this message.
            if (/\bskipped?\b/.test(t)) return 'mark_checklist';
            if (/\bi\s+(did|completed|finished)\b/.test(t) && !/\btask\b/.test(t)) return 'mark_checklist';
            // Journal: emotional/reflective language
            if (/\b(felt|feeling|i\s+feel)\b/.test(t)) return 'journal_reflection';
            if (/\btoday\s+(was|felt|went)\b/.test(t)) return 'journal_reflection';
            if (/\b(rough|good|great|bad|hard|tough)\s+day\b/.test(t)) return 'journal_reflection';
            if (/\b(mark|write|log)\s+(my\s+)?journal\b/.test(t)) return 'journal_reflection';
            if (/\b(had\s+a\s+moment|want\s+to\s+note|reflecting\s+on|i\s+want\s+to\s+write)\b/.test(t)) return 'journal_reflection';
            if (/\bi(?:'m|\s+am)\s+(proud|grateful|anxious|tired|happy|sad|frustrated|excited|worried|stressed|calm|confident|overwhelmed|relieved|energised?|drained|exhausted|burnt\s*out|motivated|depressed|lonely|content|hopeful|irritated)\b/.test(t)) return 'journal_reflection';
            return null;
        },

        // Shared task resolution against the cached list -- number match first,
        // then exact-name match. Used by complete/start/pause/delete so the
        // matching behavior (and its failure message) is identical no matter
        // which lifecycle action asked for it, rather than four near-copies
        // that could quietly drift apart.
        _resolveTaskFromFields(fields) {
            if (!_taskCache || !_taskCache.length) {
                return { task: null, message: "I don't have the task list loaded yet -- try sending your message again." };
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
                return { task: null, message: "I couldn't identify which task you meant. Say the task number or its exact name. Your pending tasks:\n" + list };
            }
            return { task, message: null };
        },

        // Resolves a task-completion intent against the cached task list.
        _handleTaskCompletion(fields, providerLabel) {
            const { task, message } = this._resolveTaskFromFields(fields);
            if (!task) { this._pushAssistantText(message, providerLabel); return; }
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

        // Shared confirm-card builder for start/pause/delete -- same
        // resolve-then-confirm shape as _handleTaskCompletion above, just
        // parameterized on the flow/title/icon/extra fields each one needs.
        _handleTaskLifecycleAction(fields, providerLabel, opts) {
            const { task, message } = this._resolveTaskFromFields(fields);
            if (!task) { this._pushAssistantText(message, providerLabel); return; }
            const cardFields = [{ k: 'Task', v: task.name }];
            if (opts.extraCardField) cardFields.push(opts.extraCardField);
            this._pushMessage({
                role: 'assistant',
                type: 'confirm',
                draft: {
                    title: opts.title,
                    icon: opts.icon,
                    fields: cardFields,
                    flowKey: opts.flowKey,
                    rawFields: Object.assign({ task_id: task.id, task_name: task.name }, opts.extraRawFields || {})
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
            // Track D (Conversational Actions) writes reuse this exact same
            // verified path -- only the flowKey prefix differs from a
            // WRITE_FLOWS entry.
            if (flowKey.startsWith('__conv:')) {
                const actionKey = flowKey.slice(7);
                try {
                    const result = await CONVERSATIONAL_ACTIONS[actionKey].write(msg.draft.rawFields);
                    msg.decided = 'saved';
                    if (this.activeAction && this.activeAction._confirmMsgId === msg.id) this.activeAction = null;
                    window.dispatchEvent(new CustomEvent('atlas:data-changed', { detail: { source: actionKey } }));
                    // create_task/create_reminder: a named project that didn't
                    // match anything still saves (standalone), but say so --
                    // never silently drop the project intent without a word.
                    if (result && result._projectRequestedButUnmatched) {
                        this._pushAssistantText(`Saved -- but I couldn't match "${msg.draft.rawFields.project}" to one of your projects, so it's standalone for now. You can link it from the app.`);
                    } else {
                        this._pushAssistantText('Saved.');
                    }
                } catch (e) {
                    msg.decided = null;
                    this.errorMsg = 'Save failed: ' + e.message;
                }
                this._persistChatHistory();
                return;
            }
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
                    // delete_task is a destructive action -- gets the exact same
                    // 8-second undo toast the manual Delete button queues (see
                    // deleteTaskOnToday() in pages/today.js), not a bespoke
                    // exception for the AI-triggered path.
                    if (flowKey === 'delete_task') {
                        const taskId = msg.draft.rawFields.task_id;
                        const taskName = msg.draft.rawFields.task_name;
                        showUndoToast(`Deleted "${taskName}"`, async () => {
                            await DB.Tasks.restoreFromTrash(taskId);
                            window.dispatchEvent(new CustomEvent('atlas:data-changed', { detail: { source: 'delete_task_undo' } }));
                        });
                    }
                    // Dispatch cross-component refresh event so Today page panels update without reload
                    if (flowKey === 'log_workout' || flowKey === 'log_sleep' ||
                        flowKey === 'complete_task' || flowKey === 'mark_checklist' ||
                        flowKey === 'start_task' || flowKey === 'pause_task' || flowKey === 'delete_task') {
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
            this._persistChatHistory();
        },
        cancelDraft(msg) {
            msg.decided = 'cancelled';
            if (msg.draft.flowKey && msg.draft.flowKey.startsWith('__conv:') && this.activeAction && this.activeAction._confirmMsgId === msg.id) {
                this.activeAction = null;
            }
            this._persistChatHistory();
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

        // Voice capture -- rebuilt 2026-08-08 on Google Cloud Speech-to-Text
        // (atlas-stt-proxy), replacing the browser's native SpeechRecognition
        // API entirely. That API turned out to be genuinely unreliable in
        // real use (sessions ending themselves regardless of continuous:true,
        // cutting sentences off, occasionally picking up Atlas's own spoken
        // reply). MediaRecorder -- record a finished clip, then transcribe it
        // server-side -- doesn't have any of that live-session flakiness;
        // start/stop are plain, well-supported browser primitives. Same
        // interaction model as before: tap to start, speak as long as you
        // want, tap again to stop -- it fills the composer, never auto-sends,
        // so a mis-transcription can be caught before it reaches the AI.
        toggleVoice() {
            if (_mediaRecorder && _mediaRecorder.state === 'recording') {
                try { _mediaRecorder.stop(); } catch (e) {}
                return;
            }
            if (this._voiceBlockedByPlayback()) { this.errorMsg = 'Wait for Atlas to finish talking first.'; return; }
            this._startRecording();
        },

        async _startRecording() {
            if (!navigator.mediaDevices || !window.MediaRecorder) {
                this.errorMsg = 'Voice input is not supported in this browser.';
                return;
            }
            // Pre-check the auth session BEFORE prompting for the mic and
            // recording a clip. The old flow was: record 20 seconds -> try to
            // transcribe -> discover the session was expired -> surface "Voice
            // transcription failed: not signed in" as a generic error, having
            // already burned the user's audio. Fail fast and cleanly instead.
            if (!getSession()) {
                this.errorMsg = 'You need to be signed in for voice input.';
                return;
            }
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (e) {
                this.errorMsg = 'Microphone access denied or unavailable.';
                return;
            }
            // Only WEBM_OPUS is supported end-to-end -- the STT proxy rejects
            // anything else with a clear error (see atlas-stt-proxy). This
            // matches Abhishek's real target devices (Android Chrome, Chrome,
            // Edge). The old code offered `audio/mp4` as a fallback for
            // Safari, but Safari's MediaRecorder produces MP4/AAC, which
            // Google Cloud STT can't decode as MP3 -- so that path would
            // record fine locally then fail server-side. Refuse it up front
            // so the user gets an honest error before the mic even opens.
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
            if (!mimeType) {
                this.errorMsg = 'Voice input needs Chrome, Edge, or Android Chrome. Safari/iOS is not currently supported.';
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            _mediaStream = stream;
            _mediaChunks = [];
            _mediaRecorder = new MediaRecorder(stream, { mimeType });
            _mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) _mediaChunks.push(e.data); };
            _mediaRecorder.onstop = () => {
                this.listening = false;
                clearTimeout(_recordingWatchdog);
                if (_mediaStream) { _mediaStream.getTracks().forEach(t => t.stop()); _mediaStream = null; }
                const chunks = _mediaChunks;
                _mediaChunks = [];
                _mediaRecorder = null;
                if (chunks.length) this._transcribeRecording(chunks, mimeType);
            };
            _mediaRecorder.start();
            this.listening = true;
            this.errorMsg = '';
            // Safety cap, not a normal-use limit -- stop a forgotten-open mic
            // after 3 minutes rather than let it record indefinitely.
            clearTimeout(_recordingWatchdog);
            _recordingWatchdog = setTimeout(() => {
                if (_mediaRecorder && _mediaRecorder.state === 'recording') { try { _mediaRecorder.stop(); } catch (e) {} }
            }, 180000);
        },

        async _transcribeRecording(chunks, mimeType) {
            const blob = new Blob(chunks, { type: mimeType });
            this.thinking = true;
            this.errorMsg = '';
            // 30s abort timeout on the transcription fetch. The old code had
            // no timeout at all -- if Google or the edge function hung, the
            // fetch would never return, this.thinking stayed true forever,
            // and sendMessage() early-returns while thinking, so the panel
            // was locked with no way to recover short of a page reload.
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30000);
            try {
                const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                // Session was already checked at _startRecording time; this
                // is a belt-and-braces re-check in case the token expired
                // during the recording itself.
                const session = getSession();
                if (!session) throw new Error('signed out during recording');
                const res = await fetch('https://vcndlorrrtueofzuynvi.supabase.co/functions/v1/atlas-stt-proxy', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ audio_base64: base64, mime_type: mimeType }),
                    signal: controller.signal
                });
                if (!res.ok) throw new Error('transcription request failed');
                const data = await res.json();
                if (data.text) {
                    this.draft = (this.draft ? this.draft + ' ' : '') + data.text;
                    this.$nextTick(() => this.autoGrowComposer());
                } else {
                    this.errorMsg = "Didn't catch that -- try again.";
                }
            } catch (e) {
                const msg = e.name === 'AbortError' ? 'Voice transcription timed out -- you can still type.' : ('Voice transcription failed: ' + e.message + ' -- you can still type.');
                this.errorMsg = msg;
            } finally {
                clearTimeout(timer);
                this.thinking = false;
            }
        },

        // True while Atlas's own voice could still be audible -- covers both
        // the cloud-TTS <audio> element and the browser speechSynthesis
        // fallback. Checked before every recording start so the mic can
        // never pick up Atlas's own reply and mistake it for the user
        // speaking (confirmed live 2026-08-08 -- a spoken read-back got
        // transcribed back in as if the user had said it).
        _voiceBlockedByPlayback() {
            if (this.currentCloudAudio && !this.currentCloudAudio.paused && !this.currentCloudAudio.ended) return true;
            if (window.speechSynthesis && window.speechSynthesis.speaking) return true;
            return false;
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
