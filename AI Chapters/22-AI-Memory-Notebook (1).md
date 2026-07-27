# Chapter 22 — AI Memory Notebook: Persistent Long-Term Memory Architecture
> Status: ✅ Approved | July 2026
> Source alignment: 19-AI-Chat-Overlay, 20-AI-Architecture-and-Security, 21-Cloud-Teacher-Local-Operator
> Applies to: All POS apps and future standalone apps

---

## 1. Why This Chapter Exists

A local AI operator (Chapter 21) has no native memory between sessions. Every conversation starts from zero. Chat history is session-scoped and deliberately wiped after a short window (24 hours by default) to keep conversations fast and context windows lean.

For any domain where the AI acts as a long-term assistant — financial strategy, project planning, learning progress, research direction — this is a structural limitation. Meaningful assistance requires continuity of standing facts:

- "We capped a specific spending category at a fixed monthly limit" (Finance)
- "A milestone is planned for a specific future date" (Task Manager)
- "The user has already mastered a specific topic and should not be re-taught it" (Learning Hub)
- "A research thread already ruled out a specific direction" (Biz Research Hub)

These are standing facts, not one-off chat turns. Repeating them at the start of every conversation is friction the user should never have to carry. The **AI Memory Notebook** eliminates that friction, and every POS app must implement it the same way.

---

## 2. What the AI Memory Notebook Is

The AI Memory Notebook is a **persistent, entry-based memory store** for the app's local AI operator. It stores compact notes — written by the AI, triggered by the user — that are automatically injected into every future conversation as context.

The AI reads its own past notes without being asked. The user does not need to recap history or say "remember when we discussed...". Memory is ambient, not retrieved on demand.

The notebook is distinct from three other stores:

- **Chat history** (Chapter 20) — session-scoped, conversational back-and-forth, short auto-wipe window.
- **The user's own personal notes feature** (if the app has one) — the user's own content, never written or read by the AI.
- **The Local Learning Library** (Chapter 21) — approved Logic Cards and examples that shape *how* the AI answers. The Notebook stores *what happened and was decided*; the Learning Library stores *how to behave*.

Every POS app that includes an AI operator must ship a Memory Notebook using this same architecture. The entry types and injection rules below are domain-agnostic; only the note content changes per app.

---

## 3. Storage Architecture

The notebook uses a two-layer storage strategy: **local storage as the read path** (instant access, works offline) and **the app's cloud backend as the backup** (durable copy, restored automatically on next sync).

**Local read path** (e.g. `localStorage`, or an app-specific local store) is read on every AI message. This keeps conversations fast with no network dependency — the AI always has its notes ready immediately, matching the Local-First principle in Chapter 20.

**Cloud backup** (e.g. a `settings.ai_notebook` column or equivalent table in Supabase) receives a copy on every normal sync cycle. This happens automatically without any user action — the same pull/push cycle that syncs the app's core domain data (transactions, tasks, lessons, research notes) also syncs the notebook. No manual export, no separate backup step.

**Conflict resolution:** If two devices both have notebook entries, the version with the most recently created entry (highest timestamp) wins and overwrites the other. This is appropriate when the AI operator is local-only per device, so conflicts are rare and recency is the correct tiebreaker. Apps with a true multi-device shared AI context may instead merge entries — document the choice explicitly if deviating from last-write-wins.

**Durability:** A browser "Clear site data" operation, reinstall, or device replacement wipes the local copy, but the cloud copy is unaffected. On next app load and sync, the notebook is pulled back from the cloud and the local store is restored. The user loses nothing.

**Why primary reads stay local, not cloud:** When the AI operator is local (Chapter 21), reading notebook entries from the cloud on every chat message would add network latency to every single Q&A exchange. Local reads are synchronous and instant. The two-layer approach gets both: speed for reads, safety for writes.

---

## 4. Entry Types

Three distinct entry types cover different memory timescales. Every app implements all three, regardless of domain.

### Pin — Moment capture
Created when the user clicks the bookmark/pin icon on an assistant message bubble (Chapter 19).

The AI generates a 2–3 line summary of that specific exchange, focused on what is worth remembering: the insight, the decision, the specific fact or number. The user does not write this note — they only decide the exchange was worth keeping. The AI does the writing.

If the AI is unreachable at the time of pinning, the first ~350 characters of the response are saved verbatim as a fallback.

**When to use:** After any response that contains a decision, a discovered pattern, or a specific fact the user wants to carry forward — regardless of domain.

### Session — Conversation summary
Created by a "Save Session" action inside the Notebook panel.

The AI summarizes the entire current conversation (last ~10 messages) into a 4–6 line brief covering: key questions asked, facts discussed, decisions made, action items.

**When to use:** At the end of any meaningful discussion — a planning session, a review, a strategy conversation — in any app.

### Compact — Memory consolidation
Created by a "Compact" action inside the Notebook panel.

The AI reads all existing notebook entries and consolidates them into a single 8–12 line brief, grouped by theme relevant to the domain (e.g. standing rules, active goals, resolved questions, open items). All prior entries are deleted and replaced with this one entry. A `covers` field records the date range of what was consolidated.

**When to use:** Monthly or quarterly, to keep the notebook focused and prevent context bloat, in any app.

---

## 5. How Memory Gets Into Conversations

Every question sent to the AI is bundled with the app's structured **Fact Package** (Chapter 21). The notebook entries are added to this package as a distinct field, capped at a fixed character budget (1,500 characters is the reference default; apps may tune this to their model's context window).

The AI's standing Persona instructions (Chapter 20) must include a routing rule equivalent to:

> "When the user's past decisions, standing strategies, or patterns noted in the AI Memory Notebook are relevant — use that context."

This routing instruction is always active. The AI checks its notebook automatically on every message. The user does not manage this step.

---

## 6. The Three-Layer Memory Model

| Layer | What it holds | Duration | User action to clear |
|---|---|---|---|
| **Chat history** | Full conversation turns | Short window (e.g. 24 hours, auto-wipe) | Clear button |
| **AI Memory Notebook** | Key insights, decisions, standing rules | Permanent | Delete per entry; Compact to consolidate |
| **Persona** | AI role, behavioral instructions | Permanent | Settings modal (PIN-gated, Chapter 20) |

All three layers are included in every AI conversation automatically. They work together — chat history for the current session's thread, notebook for accumulated long-term context, persona for standing behavioral configuration. Every POS app with an AI operator must implement all three layers, not a subset.

---

## 7. User Interface

The Notebook opens as a view swap **inside** the AI panel (Chapter 19's "panel-within-panel" pattern) — never as a separate modal or a page navigation. When the notebook opens, the message list and input footer hide; the notebook view takes their place. The panel header stays visible throughout.

**Toolbar:** Title · Save Session · Compact · Close

**Entry list:** Newest entries first. Each entry shows:
- Date
- Type badge (pin / session / compact)
- The note text
- A delete button

**Indicator dot:** The notebook button in the panel header shows a green dot when entries exist. This is ambient feedback — the user can see at a glance that the AI has accumulated context, without opening the notebook.

---

## 8. The Writing Cycle

The intended rhythm for long-term use, identical across every app:

1. **During a conversation:** Pin any response that captures a useful insight or decision.
2. **End of a meaningful session:** Click "Save Session" to capture the whole discussion.
3. **Monthly or quarterly:** Click "Compact" to consolidate everything into a single brief.

This keeps the notebook under 5–6 entries at any given time, well within the character injection limit, and ensures the AI always has the highest-signal context from the most recent period.

---

## 9. Privacy Rules

The Notebook inherits the privacy classification rules from Chapter 21 §8:

- Notebook content follows the same `local-only` / `sanitised-for-cloud` / `cloud-approved` / `synthetic` levels.
- By default, notebook entries are `local-only` and are never sent to a Cloud Teacher (Vertex) request unless the user explicitly approves that specific entry for review.
- Sensitive domains (finance, health, private vault, family information) default the notebook to `local-only` with no exceptions unless explicitly overridden per entry.

---

## 10. New App Notebook Checklist

Before shipping an AI Memory Notebook in any new POS app, confirm:

- What are 3–5 example "standing facts" this app's users would want remembered? (mirrors the checklist style in Chapter 21 §11)
- What local storage key and cloud column/table will hold notebook entries?
- What is the character budget for notebook injection, given this app's model context window?
- What conflict resolution applies if the app supports true multi-device shared AI context?
- What default privacy level applies to this domain's notebook entries?

---

## 11. Design Principles Demonstrated

**AI does the writing, user does the curating.**
The user decides what is worth keeping. The AI decides how to express it compactly. Neither does the other's job. This split prevents the notebook from becoming either too sparse (user can't be bothered to write) or too verbose (AI writes everything without judgment about importance).

**Memory is injected, not recalled.**
The AI does not need to be asked "do you remember...". Memory is part of the context it receives on every message, like a briefing document that's always on the desk.

**Compact prevents memory rot.**
Without consolidation, a notebook of 50 entries over a year would become unwieldy — full of outdated decisions, superseded strategies, resolved issues. The Compact feature treats the notebook as a living document that gets refined over time, not an append-only log.

**Durability without ceremony.**
The notebook backs up to the cloud automatically on every sync — no export button to remember, no manual backup routine. The user accumulates months or years of strategic memory and it persists across browser reinstalls, device replacements, and data clears.

**Speed and safety are not a tradeoff.**
Local reads give instant access (synchronous, no network). Cloud backup gives durable writes (survives everything). The two-layer architecture delivers both simultaneously — reads hit local storage, writes go to both.

**One notebook pattern, many domains.**
Finance Manager, Task Manager, Learning Hub, Biz Research Hub, and every future POS app implement the identical three entry types, three-layer model, and panel-within-panel UI. Only the note content and Fact Package differ by domain.
