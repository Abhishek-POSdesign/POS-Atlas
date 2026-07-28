# Google Cloud Text-to-Speech — Atlas Integration Handover

**Status:** Google Cloud service account and JSON private key created  
**Purpose:** Replace browser SpeechSynthesis with a natural, server-backed Text-to-Speech provider for Atlas AI replies  
**Priority:** Future Phase 2 / post-trial work — do not integrate until the Atlas real-usage trial is complete  
**Last updated:** 2026-07-28

---

## 1. Objective

Atlas already supports:

- Voice input through browser speech recognition / Wispr Flow workflow
- AI replies as text
- Optional browser SpeechSynthesis voice replies

The built-in browser voice quality is not satisfactory. The future goal is to use **Google Cloud Text-to-Speech** to produce natural MP3 audio replies for Atlas.

This is **Text-to-Speech output only**. It is not a replacement for Wispr Flow or speech recognition input.

---

## 2. Google Cloud identity

### Service account

A dedicated Google Cloud Service Account has been created:

- **Name:** `pos-tts-proxy`
- **Purpose:** Allow the backend only (Supabase Edge Function) to authenticate to Google Cloud Text-to-Speech.

### Private key

A JSON private key file was generated for this service account.

**Critical security rule:**

- Never place the JSON file, any field from it, access tokens, or a Google API key in browser JavaScript, HTML, `localStorage`, Git, screenshots, chat messages, or client-visible Supabase configuration.
- The complete JSON file must be stored only as a Supabase Edge Function secret, for example:

```text
GCP_SERVICE_ACCOUNT_KEY
```

- The Edge Function reads the secret server-side and exchanges it for a short-lived Google OAuth 2.0 access token.
- The browser must only send Atlas reply text to the authenticated Supabase Edge Function and receive generated audio back.

### Current IAM role

The service account currently has:

```text
Service Usage Consumer
roles/serviceusage.serviceUsageConsumer
```

This role permits enabled-service usage/billing behaviour. Before implementation, verify the minimum additional Text-to-Speech invocation permission needed for the `text.synthesize` API call.

**Least-privilege requirement:**

- Do not grant Project Owner, Project Editor, or broad unrelated roles.
