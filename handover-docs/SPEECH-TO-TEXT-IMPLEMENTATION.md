# Speech-to-Text (STT) — portable implementation guide

**Purpose:** drop-in guide for adding voice input (speech → text) to any of Abhishek's apps that already has Google Cloud Text-to-Speech working. Written to be handed to an agent working in a *different* repo with no access to this conversation — everything needed is in this file.

**Proven working:** Atlas (`atlas.abhisheksikka.com`), 2026-08-09, on Android Chrome and Windows Chrome/Edge. Transcription accuracy confirmed good ("catching the correct phrase and correct words").

---

## 0. Read this first — the one architectural decision that matters

**Do NOT use the browser's native `SpeechRecognition` / `webkitSpeechRecognition` API.** It is the obvious choice and it is the wrong one. It was built, shipped, and removed from Atlas after real-world failure:

- Sessions end themselves unpredictably, *ignoring* `continuous = true`.
- Transcripts finalise mid-sentence at a pause the browser misjudges — the user experiences this as "it cuts me off" / "catches half words."
- On a device with speakers, it can pick up the app's own text-to-speech reply and transcribe it as if the user said it.

These are properties of live streaming recognition, not bugs you can patch. Every attempt to work around them (watchdogs, longer timeouts, guard flags) failed.

**Use instead: record-then-transcribe.**

```
MediaRecorder captures a complete audio clip
  → user taps stop (no pause detection, no silence timer)
  → clip is base64'd and POSTed to a Supabase Edge Function
  → Edge Function calls Google Cloud Speech-to-Text
  → plain text comes back
  → text fills the input box for the user to review
  → user sends it themselves
```

`MediaRecorder` is a plain recorder. It has no opinion about whether the user has finished a sentence. It records until told to stop. That single property is what fixes the entire class of bug above.

**Trade-off, accept it knowingly:** transcription is not live/word-by-word. There is a short processing pause after the user taps stop, then the text appears. This is the correct trade — reliability over the illusion of real-time.

---

## 1. This is independent of your chat model provider

Worth stating plainly because it's the first thing that gets asked:

**STT and TTS have nothing to do with which model answers chat.** They are separate Google Cloud services reached through their own Edge Functions. Whether the app's chat is running on a local Ollama model, Gemini via Vertex, or anything else, voice input and voice output work identically. There is no shared code path, no shared provider toggle, no coupling.

Do not wire voice into the chat provider selection. Do not disable voice when the provider is local.

---

## 2. Prerequisites in Google Cloud — BOTH are required

This is where the first Atlas implementation lost a full debug cycle. Having **Text-to-Speech** and **Vertex AI** already working does **not** mean Speech-to-Text will work. They are separate products with separate switches.

Symptom if either is missing: **100% failure rate**, every call, with an opaque error.

### 2a. Enable the Cloud Speech-to-Text API

https://console.cloud.google.com/apis/library/speech.googleapis.com

If the button says **Enable**, it's off. Click it. Wait ~1 minute for propagation.

### 2b. Grant `roles/speech.client` to the service account

The service account is the one behind the JSON key already stored in your Supabase secrets (the same one TTS uses). In Atlas that's `pos-tts-proxy@project-80489c04-751e-48a3-93a.iam.gserviceaccount.com` and the secret is named `GCP_SERVICE_ACCOUNT_KEY`.

Run in Google Cloud Shell:

```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:YOUR_SERVICE_ACCOUNT_EMAIL" \
    --role="roles/speech.client"
```

Verify the output lists `roles/speech.client` under your service account.

### 2c. Supabase secret

No new secret needed if TTS already works — reuse the same service-account JSON key. The OAuth scope used (`https://www.googleapis.com/auth/cloud-platform`) is broad and already covers Speech-to-Text.

**If the target app is on a different Supabase project** than the one with the working TTS, you must copy the same service-account JSON into that project's secrets under the same name.

---

## 3. The Edge Function

Deploy as `<app>-stt-proxy` (Atlas uses `atlas-stt-proxy`). `verify_jwt: true`.

Two things to preserve if you modify this:

1. **The JWT/OAuth exchange is hand-rolled on purpose.** Do not replace it with the official `@google-cloud/speech` SDK. That library is a heavy Node-oriented dependency chain (gaxios, gcp-metadata, etc.) and is a known source of import/runtime failures in Supabase's Deno Edge runtime. The code below uses only Deno-native Web Crypto + fetch.
2. **Never hide the upstream Google error.** The first version logged Google's response server-side and returned a bare "Internal Server Error." That made a total-failure bug undiagnosable from the app. The version below returns Google's real status and detail, with plain-English translation for the three likely cases.

```ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

// --- CORS: reflect prod origin or any localhost port (for local dev) ---
const PROD_ORIGIN = 'https://YOUR-APP-DOMAIN.com';
const DEV_ORIGIN_PATTERN = /^http:\/\/localhost:\d+$/;
function pickCorsOrigin(reqOrigin: string | null): string {
  if (!reqOrigin) return PROD_ORIGIN;
  if (reqOrigin === PROD_ORIGIN) return PROD_ORIGIN;
  if (DEV_ORIGIN_PATTERN.test(reqOrigin)) return reqOrigin;
  return PROD_ORIGIN;
}
function buildCorsHeaders(reqOrigin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': pickCorsOrigin(reqOrigin),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

// Sanity ceiling: several minutes of Opus audio. Not a normal-use limit.
const MAX_AUDIO_BASE64_CHARS = 15_000_000;

function base64url(input: string | Uint8Array): string {
  let base64: string;
  if (typeof input === 'string') {
    base64 = btoa(input);
  } else {
    let binary = '';
    for (let i = 0; i < input.length; i++) binary += String.fromCharCode(input[i]);
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getGoogleAccessToken(gcpKey: { client_email: string; private_key: string }): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: gcpKey.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const keyData = pemToArrayBuffer(gcpKey.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64url(new Uint8Array(signature))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Google OAuth token exchange failed: ${await tokenRes.text()}`);
  return (await tokenRes.json()).access_token;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // --- Auth: caller must be a signed-in Supabase user ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || ''
    );
    const { data: { user }, error: authError } =
      await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // --- Payload ---
    const { audio_base64, mime_type } = await req.json();
    if (!audio_base64 || typeof audio_base64 !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid or missing audio_base64' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (audio_base64.length > MAX_AUDIO_BASE64_CHARS) {
      return new Response(JSON.stringify({ error: 'Audio clip too large' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Only WEBM_OPUS is supported end-to-end. See §5 for why.
    if (!(mime_type || '').includes('webm')) {
      return new Response(JSON.stringify({
        error: 'Unsupported audio codec — expects audio/webm;codecs=opus (Android Chrome / Chrome / Edge). Safari/iOS is not supported.'
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- Google auth + call ---
    const gcpKeyString = Deno.env.get('GCP_SERVICE_ACCOUNT_KEY');
    if (!gcpKeyString) throw new Error('GCP_SERVICE_ACCOUNT_KEY secret not found in environment');
    const accessToken = await getGoogleAccessToken(JSON.parse(gcpKeyString));

    // latest_short: voice turns are typically 3–15s. More accurate AND cheaper
    // than latest_long at that length. sampleRateHertz is intentionally OMITTED
    // for WEBM_OPUS — Google derives it from the Opus header, and passing an
    // explicit value can be rejected as inconsistent with the container.
    const sttResponse = await fetch('https://speech.googleapis.com/v1/speech:recognize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        config: {
          encoding: 'WEBM_OPUS',
          languageCode: 'en-US',
          model: 'latest_short',
          enableAutomaticPunctuation: true
        },
        audio: { content: audio_base64 }
      })
    });

    // NEVER swallow this error. See §0 / §6.
    if (!sttResponse.ok) {
      const errorText = await sttResponse.text();
      console.error('Google STT Error:', sttResponse.status, errorText);
      let friendly = `Google Speech-to-Text returned ${sttResponse.status}.`;
      if (errorText.includes('SERVICE_DISABLED') || errorText.includes('has not been used in project') || errorText.includes('is disabled')) {
        friendly = 'The Cloud Speech-to-Text API is not enabled on this Google Cloud project. Enable it in the Google Cloud console, wait a minute, then try again.';
      } else if (sttResponse.status === 403) {
        friendly = 'Google denied the Speech-to-Text request (403). The service account likely lacks roles/speech.client.';
      } else if (sttResponse.status === 400) {
        friendly = 'Google rejected the audio (400). The recording format may not match what was declared.';
      }
      return new Response(JSON.stringify({
        error: friendly, googleStatus: sttResponse.status, googleDetail: errorText.slice(0, 600)
      }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const sttData = await sttResponse.json();
    const transcript = (sttData.results || [])
      .map((r: any) => r.alternatives?.[0]?.transcript || '')
      .join(' ')
      .trim();

    console.log(`STT: user=${user.id} audioChars=${audio_base64.length} transcriptChars=${transcript.length}`);

    return new Response(JSON.stringify({ text: transcript }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Edge Function Exception:', error);
    return new Response(JSON.stringify({
      error: 'Speech-to-Text failed: ' + ((error as Error).message || 'unknown error')
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
```

---

## 4. Client-side code

Module-level state (deliberately **not** inside a reactive store — browser API objects and reactive proxies interact badly):

```js
let _mediaRecorder = null;
let _mediaStream = null;
let _mediaChunks = [];
let _recordingWatchdog = null;
```

Component state: `listening` (boolean, drives the mic button's active style), `thinking` (boolean, shown while transcribing), `errorMsg` (string), `draft` (the composer text).

### Toggle (bound to the mic button)

```js
toggleVoice() {
    if (_mediaRecorder && _mediaRecorder.state === 'recording') {
        try { _mediaRecorder.stop(); } catch (e) {}
        return;
    }
    // Don't open the mic while the app's own TTS is still audible —
    // otherwise it can transcribe the app's reply as user speech.
    if (this._voiceBlockedByPlayback()) {
        this.errorMsg = 'Wait for the assistant to finish talking first.';
        return;
    }
    this._startRecording();
},

_voiceBlockedByPlayback() {
    if (this.currentCloudAudio && !this.currentCloudAudio.paused && !this.currentCloudAudio.ended) return true;
    if (window.speechSynthesis && window.speechSynthesis.speaking) return true;
    return false;
},
```

### Start recording

```js
async _startRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
        this.errorMsg = 'Voice input is not supported in this browser.';
        return;
    }
    // Check auth BEFORE opening the mic — don't let the user record 20
    // seconds only to discover their session expired.
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
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : '';
    if (!mimeType) {
        this.errorMsg = 'Voice input needs Chrome, Edge, or Android Chrome.';
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

    // Safety cap for a forgotten-open mic. Not a normal-use limit.
    clearTimeout(_recordingWatchdog);
    _recordingWatchdog = setTimeout(() => {
        if (_mediaRecorder && _mediaRecorder.state === 'recording') {
            try { _mediaRecorder.stop(); } catch (e) {}
        }
    }, 180000);
},
```

### Transcribe

```js
async _transcribeRecording(chunks, mimeType) {
    const blob = new Blob(chunks, { type: mimeType });
    this.thinking = true;
    this.errorMsg = '';
    // Always time-bound this. Without it, a hung request leaves `thinking`
    // true forever and locks the composer with no recovery but a reload.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        const session = getSession();
        if (!session) throw new Error('signed out during recording');

        const res = await fetch('https://YOUR-PROJECT.supabase.co/functions/v1/YOUR-APP-stt-proxy', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + session.access_token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ audio_base64: base64, mime_type: mimeType }),
            signal: controller.signal
        });

        // Pass the server's real message through — do NOT replace it with a
        // generic string. See §6.
        if (!res.ok) {
            let serverMsg = '';
            try { const errBody = await res.json(); serverMsg = errBody.error || ''; } catch (e) {}
            throw new Error(serverMsg || ('transcription request failed (' + res.status + ')'));
        }

        const data = await res.json();
        if (data.text) {
            this.draft = (this.draft ? this.draft + ' ' : '') + data.text;
        } else {
            this.errorMsg = "Didn't catch that — try again.";
        }
    } catch (e) {
        this.errorMsg = e.name === 'AbortError'
            ? 'Voice transcription timed out — you can still type.'
            : ('Voice transcription failed: ' + e.message + ' — you can still type.');
    } finally {
        clearTimeout(timer);
        this.thinking = false;
    }
},
```

### Minimal UI

```html
<button class="mic-btn" :class="{ 'mic-listening': listening }" @click="toggleVoice()"
        :title="listening ? 'Stop listening' : 'Voice input'">
  <!-- mic icon svg -->
</button>
<div class="hint">Tap the mic, speak, tap again to review before sending</div>
```

`.mic-listening` should be visually obvious (Atlas uses a filled coral circle). The user must always be able to tell whether the mic is open.

---

## 5. Browser / codec support

| Browser | Works | Notes |
|---|---|---|
| Chrome (desktop) | Yes | `audio/webm;codecs=opus` |
| Edge (desktop) | Yes | Same |
| Chrome (Android) | Yes | Same — primary mobile target |
| Safari / iOS | **No** | Produces MP4/AAC, which Google STT cannot decode as declared. Deliberately unsupported for Abhishek's apps — no Apple devices in the family (confirmed 2026-08-08). |

If Safari support is ever genuinely needed, the fix is to decode the recording to raw PCM client-side via `AudioContext.decodeAudioData` and send `LINEAR16` — **not** to declare MP4 as MP3, which silently fails.

---

## 6. Gotchas that will bite you

1. **Enabling TTS ≠ enabling STT.** Separate API switches. Missing one = 100% failure. §2.
2. **Missing `roles/speech.client`** = 403 on every call, even with a valid key. §2b.
3. **Never return a generic error from the proxy or the client.** Two layers each replacing Google's real message with "something went wrong" is exactly what made the original Atlas failure undiagnosable. Both layers must pass the upstream message through.
4. **Don't set `sampleRateHertz` for WEBM_OPUS.** Google derives it from the container header; an explicit mismatched value gets rejected.
5. **Always add a fetch timeout.** No timeout = a hung request permanently disables the composer.
6. **Check the session before opening the mic**, not after recording.
7. **Never auto-send the transcript.** Fill the input and let the user read it first. A mis-transcription that goes straight into an action is how you get wrong data written. (In Atlas, voice feeds a confirm-before-write flow — the transcript is never itself the commit.)
8. **Guard against transcribing your own TTS.** If the app speaks replies aloud, block mic-open while audio is playing. §4.

---

## 7. Cost

Google Cloud Speech-to-Text: **60 minutes free per month, perpetually**, then roughly **$0.016/minute** for the standard real-time model.

Billing is on *audio duration submitted for transcription* — i.e. how long the mic was actually recording. It has nothing to do with how much the app speaks back (that's Text-to-Speech, billed separately) or how long the conversation is.

Realistically: a voice command like "log my sleep, eight hours, score 82" is ~4 seconds. Hundreds of those per month sit comfortably inside the free tier.

---

## 8. Checklist for a new app

- [ ] Speech-to-Text API enabled on the GCP project (§2a)
- [ ] `roles/speech.client` granted to the service account (§2b)
- [ ] Service-account JSON present in that app's Supabase secrets as `GCP_SERVICE_ACCOUNT_KEY` (§2c)
- [ ] Edge Function deployed as `<app>-stt-proxy`, `verify_jwt: true`, `PROD_ORIGIN` updated (§3)
- [ ] Client code added, function URL updated (§4)
- [ ] Mic button with a clear active state (§4)
- [ ] Verified: tap mic, speak a sentence *with a deliberate pause in the middle*, tap again — full sentence should transcribe, not just the first half
- [ ] Verified: error path shows a real message (temporarily disable the API to test, if you want certainty)

---

## 9. Deployment map — the four apps, as actually built (2026-08-09)

This guide was written before the rollout. What was actually built is **two
shared proxy pairs, not four**, because the apps sit on only two Supabase
projects. Don't fork a per-app copy — extend the shared one and add the new
origin to its allowlist.

### Supabase project `vcndlorrrtueofzuynvi` — "Sikka Personal Apps"

| Function | Used by |
|---|---|
| `atlas-stt-proxy` | Atlas (`atlas.abhisheksikka.com`), Finance (`finn.abhisheksikka.com`) |
| `atlas-tts-proxy` | Atlas, Finance |

Secret name: `GCP_SERVICE_ACCOUNT_KEY`. Auth: **real Supabase user session**
only — both apps have logins, and both functions verify the token server-side
with `auth.getUser()`. The anon key alone is rejected.

### Supabase project `wxijlrwoiaeaupaaqecc` — "Sikka Business Apps"

| Function | Used by |
|---|---|
| `stt-proxy` | Learning Hub (`learntech.abhisheksikka.com`), Biz Research Hub (`biz.abhisheksikka.com`) |
| `learning-hub-tts` | Learning Hub, Biz Research Hub |

Secret name: `GOOGLE_SERVICE_ACCOUNT_JSON` (note: **different** from the
personal project's). `learning-hub-tts` is named after one app for historical
reasons; it is the shared voice proxy for that project now.

**Auth here is a dual gate**, because the two apps are not alike:

1. **A valid Supabase user session** — Learning Hub, which has a real login.
2. **`x-app-secret` matching `APP_SHARED_SECRET`** — Biz Research Hub, which
   has no Supabase login at all (single user, hardcoded `profile_id`) and so
   cannot present a session. It reuses the same secret it already had for
   `vertex-chat`.

### The security rules that came out of this rollout

Both were **real holes found in the live `learning-hub-tts`**, not
hypotheticals. Read them before touching any voice function:

1. **Never gate an auth check on the presence of its own configuration.**
   The old code wrapped its user check in
   `if (supabaseUrl && supabaseAnonKey) { ... }`, so a missing or renamed
   environment variable silently switched authentication **off** and left a
   billed Google API open to anyone. Missing config must be a 500, never a
   free pass.

2. **Never reflect the request's Origin in CORS.** The old code returned
   `Access-Control-Allow-Origin: <whatever origin asked>`, meaning any website
   on the internet could call it from a visitor's browser. Use a strict
   allowlist. These functions spend real money.

3. **Never accept the anon key alone as proof of identity.** It is readable in
   the page source by anyone who opens DevTools. Require either a real user
   session or a genuine shared secret.

Verified after the fix — all four return 401, and an unknown origin gets the
default origin back rather than its own:

```bash
# anon key only, no session, no secret -> 401 on every one of them
curl -X POST "$PROJECT/functions/v1/stt-proxy" -H "Authorization: Bearer $ANON_KEY" -d '{}'
```

### Per-app notes

- **Atlas** — reference implementation, matches §4 exactly.
- **Finance** — same functions as Atlas. Replaced *both* browser built-ins
  (`webkitSpeechRecognition` **and** `speechSynthesis`) in
  `v2/js/modules/aiAssistant.js`.
- **Learning Hub** — STT added; Google TTS already existed. Its mic button
  had been shared between "recording" and "coach is speaking" state and was
  split so the mic reports only its own state.
- **Biz Research Hub** — had no voice at all. Mic added to the chat composer,
  read-aloud added per assistant message, both gated on the shared secret
  being set (voice is switched off, with a message, when it is missing).
