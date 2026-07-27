# Chapter 20 — AI Architecture, Security, and Memory Management
> Status: ✅ Approved | July 2026
> Source alignment: 19-AI-Chat-Overlay

## 1. Why This Chapter Exists

An AI assistant in a productivity app is only as good as its context, security, and performance. If an AI forgets past decisions, leaks sensitive prompt constraints, or forces the user onto an expensive cloud model when a free local model would suffice, it fails its purpose as a Personal OS helper.

This chapter defines the strict architectural patterns for how the POS integrates AI models (Cloud vs. Local), how it enforces behavioral constraints (Persona System), how it protects those constraints (PIN Security), and how it manages long-term conversational memory without bloating token limits.

---

## 2. Hybrid Model Routing (Local vs. Cloud)

The POS is designed to be environment-agnostic, supporting a fallback-driven hybrid model approach. 

- **Local-First (Ollama / LM Studio):** The system must allow users to route queries to local models (e.g., `llama3.2`, `phi3`) running on `localhost`.
  - **Manual Override:** The UI must provide an explicit text input to manually specify the exact local model name. This bypasses automated model-fetching checks (which often fail due to CORS) and ensures 100% manual control over local routing.
- **Cloud-Fallback (Vertex AI / Gemini):** For heavier reasoning tasks, the system falls back to a cloud provider via a secure serverless proxy. 
- **The Golden Rule:** The frontend must never enforce one over the other. The user decides the provider per session or per prompt.

---

## 3. The Structured Persona System

A generic "helpful assistant" prompt is insufficient for specialized workflows. The POS uses a **Structured Persona System** to force the AI into a specific operational mode.

Instead of a single unstructured text box for "System Instructions", the Persona is built from a rigid 7-field form:
1. **Role / Identity**
2. **Job Description**
3. **Targets / KPIs**
4. **Knowledge Hub / Domain constraints**
5. **About Me (User context)**
6. **Responsibilities**
7. **Strict Instructions (What NOT to do)**

These fields are compiled at runtime into a monolithic `GLOBAL AI PERSONA` system instruction block, prepended to every conversation. This guarantees that the AI cannot hallucinate its core directives.

---

## 4. Persona Security & PIN Protection

Because the Persona dictates how the AI behaves (and may contain sensitive user preferences or API keys), the Persona Settings UI is treated as a secure enclave.

- **6-Digit PIN Lock:** Accessing or modifying the Persona settings requires a strict 6-digit numeric PIN.
  - The UI must use `inputmode="numeric"` and `pattern="[0-9]{6}"` to trigger the native number pad on mobile devices, ensuring frictionless entry.
- **Safe Recovery Flow (Forgot PIN):** If a user forgets their PIN, the app must provide a secure recovery path. Resetting the PIN clears the lock hash **without** deleting the persona text, notes, chat history, or progress. This protects the data from casual tampering while avoiding catastrophic data loss if the user forgets their PIN.

---

## 5. Contextual Binding

The AI must never start a conversation blank if the user is already deep into a specific topic.
- When the user opens the AI Chat Overlay from a specific chapter or view, the chat binds to that `topicId`.
- The system automatically feeds the AI the context of the current view (e.g., "The user is currently studying Chapter 4: Layouts").

---

## 6. Long-Term Memory (Chat Compaction)

Large Language Models have finite context windows. Storing a 50-turn conversation verbatim leads to excessive token usage, slow responses, and model amnesia (forgetting instructions placed early in the chat).

To solve this, the POS implements a **Chapter-Level Memory Compaction** mechanism:
- **The "Compact" Action (📦):** A user-triggered or auto-triggered action that archives older messages.
- **Structured Extraction:** The system sends the older chat history to the AI with a strict prompt to extract a JSON memory block containing:
  - 2-3 sentence summary
  - Decisions made
  - Open questions
  - User preferences
  - Active constraints
  - Next steps
- **Verbatim Tail:** The system keeps the last 6 turns (messages) completely verbatim so the immediate conversation flow remains unbroken.
- **Synthetic Context Injection:** The extracted JSON memory is injected into the prompt history as a hidden system/context message (`__compact_ctx__`). The UI renders this as a neat banner (not a chat bubble).
- **Raw Archive:** The original raw messages are preserved in a hidden archive, accessible via a toggle, ensuring no data is permanently lost.
