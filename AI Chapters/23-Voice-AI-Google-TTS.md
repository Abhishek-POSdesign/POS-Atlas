# Chapter 23: Voice AI — Implementing Google Cloud TTS

This chapter documents the architectural decisions, constraints, and specific implementation details for giving an AI assistant a high-quality human voice using Google Cloud Text-to-Speech (TTS), exactly as implemented in the Atlas app. 

When bringing Cloud TTS into any application—especially replacing native browser `SpeechSynthesis`—it is critical to adhere to these patterns. They solve real-world problems around cross-origin Deno environments, text sanitization, user experience (UX), and cost/limit management.

---

## 1. Architectural Overview

**The Golden Rule:** The frontend client **never** talks to Google Cloud directly. All Atlas ecosystem apps (Atlas core, Learning Hub, Health, POS) should reuse this shared TTS proxy pattern and a centrally managed service account. Do not create separate ad-hoc TTS stacks per app.

Giving the client direct access would require exposing a Google API key, which is a massive security risk. Instead, we use a proxy architecture:

1. **Client-side:** The app strips Markdown from the AI's reply and sends the plain text to a backend proxy. It authenticates with the proxy using the user's standard session token (e.g., a Supabase JWT).
2. **Edge Function (Proxy):** A serverless Edge Function (in Atlas, `atlas-tts-proxy` running on Supabase/Deno) validates the user's JWT. It then authenticates securely with Google Cloud using a server-side Service Account Key, makes the TTS request, and pipes the resulting binary MP3 stream back to the client.
3. **Client-side Audio:** The client receives the Blob, creates a temporary Object URL, and plays it natively via the HTML5 `Audio` API.

---

## 2. Server-Side: The Edge Function Proxy

### Native Web Crypto Auth (Avoid Heavy SDKs)
In Edge environments (like Supabase Deno, Cloudflare Workers, or Vercel Edge), heavy Node-oriented SDKs like `google-auth-library` are fragile and often crash due to missing Node globals or filesystem dependencies.

**The Solution:** Generate the OAuth2 token manually using the runtime's native Web Crypto API (`crypto.subtle`). 
- Construct a JWT claiming access to `https://www.googleapis.com/auth/cloud-platform`.
- Sign it using the Service Account's private key (`RSASSA-PKCS1-v1_5`).
- `POST` the signed JWT to `https://oauth2.googleapis.com/token` to exchange it for an active `access_token`.
- Use this `access_token` in the standard `Authorization: Bearer` header when calling `https://texttospeech.googleapis.com/v1/text:synthesize`.

To avoid re-generating a token for every single TTS call, cache the access_token in memory inside the Edge Function until it expires (typically 1 hour). Subsequent synth requests reuse the cached token. When it expires, generate a new one using the same Web Crypto flow.

For Atlas and sibling apps we currently use plain input.text only. If an app needs pauses, emphasis, or special pronunciation, it may use SSML (input.ssml) cautiously and must still respect the same MAX_CHARS limit and sanitization rules.

### Voice Profiles and Locale Mapping
Never expose raw Google voice names (like `en-IN-Neural2-B`) directly in your frontend UI. Use semantic aliases (e.g., `atlas_calm`, `atlas_clear`). 

In the Edge Function, maintain a strict mapping dictionary. **Crucially, you must explicitly pair the voice name with its exact matching `languageCode`.** If you request a voice like `en-IN-Neural2-B` but pass `languageCode: 'en-US'`, Google's API will either silently fallback to a different voice or throw a hard 500 error.

```typescript
const VOICE_MAP: Record<string, { name: string; languageCode: string }> = {
  atlas_calm: { name: 'en-IN-Neural2-B', languageCode: 'en-IN' }, 
  atlas_clear: { name: 'en-US-Neural2-D', languageCode: 'en-US' },
};
```

### Server-Side Truncation 
Google Cloud TTS has hard character limits for synchronous requests (~5,000 chars). Furthermore, you do not want an AI rambling for 5 minutes hands-free.

Set a strict `MAX_CHARS` limit on the server (e.g., 3,000). **If a text exceeds this limit, do not reject it with an error.** Instead, truncate it gracefully at the last sentence boundary (`[.?!]`) that fits within the limit. Google Cloud TTS charges per character. When choosing MAX_CHARS per request for a given app, always check the current TTS pricing page and align limits with the app’s expected usage and budget.

```typescript
// Truncate at the last sentence boundary within the limit
const clipWindow = text.substring(0, MAX_CHARS);
const match = clipWindow.match(/[\s\S]*[.?!](?=\s|$)/);
synthText = match ? match[0] : clipWindow;
```

Tell the client that truncation occurred by returning a custom header in the response: `X-Voice-Truncated: 'true'`. **Remember to expose this header in your CORS `Access-Control-Expose-Headers` list, or the browser will hide it from the frontend.**

---

## 3. Client-Side: The Frontend Implementation

### Markdown Sanitization
AI models reply in Markdown. If you feed Markdown directly into a TTS engine, it will literally speak the words "asterisk asterisk" or read out full URLs.

Before sending text to the proxy, run a robust regex sanitizer to strip formatting while preserving the conversational prose:
- Remove system prompts `[System: ...]`
- Remove bold/italic markers `**`, `*`, `_`
- Remove inline code ticks `\``
- Remove Markdown headings `#`
- Remove list dashes/bullets `-`, `*`
- Strip literal URLs `http...`
- Remove numbered list prefixes like 1. / 2. when they appear at the start of a line.
- Remove table pipes and borders (|, ---) that do not carry meaningful spoken content.

### State Management & UI Feedback
Audio generation takes time (typically 500ms - 2s depending on text length). The UI must reflect this state machine exactly:
1. `idle`: Standard play icon.
2. `loading`: User clicks play. Change icon to a small spinner immediately.
3. `playing`: Audio starts. Change icon to a "Stop" or "Pause" indicator.

### Truncation Hints (No Guessing)
Because the server is the sole source of truth for truncation, the client must wait for the fetch response. If `res.headers.get('X-Voice-Truncated') === 'true'`, reveal a small UI hint near the play button:
> "✂ Voice plays only part of this very long reply."

### Failures and Fallbacks
If the Cloud TTS fetch fails (e.g., 500 error, network drop), **do not silently fall back to the native robotic browser voice.** The user specifically selected a premium voice; falling back to a jarring, low-quality browser voice ruins the premium feel.

Instead:
1. Revert the state to `idle`.
2. Fire a transient error toast (e.g., "Voice failed to load").
3. Halt playback.

### Cleanup and Interruption
Users are impatient. If they click stop, close the chat, or toggle the voice off while audio is `playing` or `loading`:
- If `loading`: The fetch promise might still resolve. When it does, check if the state was reset to `idle` during the flight. If so, immediately discard the blob and do nothing.
- If `playing`: Pause the `Audio` object, call `URL.revokeObjectURL()` to free memory, and nullify the reference. 

---

## Summary Checklist for Developers

1. [ ] **Proxy Architecture:** Ensure frontend never holds Google credentials.
2. [ ] **Web Crypto Auth:** Use native Deno/Edge crypto for JWT token generation; avoid heavy Node SDKs.
3. [ ] **Strict Locales:** Map both `name` and `languageCode` precisely per voice.
4. [ ] **Markdown Strip:** Clean AI text of all formatting symbols before sending.
5. [ ] **Graceful Truncation:** Clip at sentence boundaries server-side; notify client via custom headers (with CORS).
6. [ ] **State Machine:** Show a spinner while waiting for the audio Blob.
7. [ ] **No Silent Fallbacks:** Toast an error on failure; do not fallback to robotic local voices.
8. [ ] **Learning Hub Tone Check:** For content-heavy apps like the Learning Hub, validate TTS on real lesson explanations and course previews to confirm that sanitization, truncation, and voice tone feel natural for education use.
