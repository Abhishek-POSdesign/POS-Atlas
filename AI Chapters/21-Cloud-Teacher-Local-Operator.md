# Chapter 21 — Cloud Teacher, Local Operator
> Status: ✅ Approved | July 2026
> Source alignment: 19-AI-Chat-Overlay, 20-AI-Architecture-and-Security-and-Memory-Management
> Applies to: All POS apps and future standalone apps

## 1. Why This Chapter Exists

The POS uses AI in more than one way.

A local model is useful for private, everyday assistance inside an app. It can explain information, draft content, summarise context, suggest next steps, and help the user think.

A cloud model such as Vertex AI / Gemini can be stronger at complex reasoning, pattern design, creating high-quality examples, testing weak answers, and identifying edge cases.

However, the cloud model must not become an uncontrolled replacement for local AI, app logic, or user judgement.

This chapter defines a reusable intelligence system for every POS app:

- The app provides factual data and executes approved actions.
- The local model is the normal private day-to-day operator.
- Vertex AI acts as an optional teacher, evaluator, and pattern creator.
- The user approves what becomes reusable knowledge.
- A local model improves first through better instructions and approved examples.
- Fine-tuning is considered only later, after enough high-quality reviewed examples exist.

This is not a Finance-only pattern. It applies to Finance Manager, Task Manager, Learning Hub, Biz Research Hub, POS, and every future app.

---

## 2. The Core Principle

### Cloud Teacher, Local Operator

The system uses three separate roles.

| Role | Responsibility | Must Not Do |
|---|---|---|
| **App Logic** | Calculate facts, apply rules, read/write approved records, enforce permissions | Ask AI to calculate critical business truth or silently make important decisions |
| **Local AI Operator** | Give normal daily help using local context, approved patterns, and clear boundaries | Become an uncontrolled chatbot, invent facts, or silently write data |
| **Cloud AI Teacher** | Create patterns, examples, evaluation cases, quality rubrics, and improvement suggestions | Become the hidden source of truth, directly change live app data, or automatically train local models |

The non-negotiable rule is:

> **App logic owns facts and actions. AI owns interpretation, explanation, drafting, suggestions, and learning support.**

For example:

- The Finance app calculates income, expenses, bill due dates, and budget status.
- The Task Manager calculates task status, deadlines, and completion progress.
- The Learning Hub stores lessons, notes, and quiz results.
- The local AI explains these facts in a helpful way.
- Vertex helps create stronger response patterns and tests whether the local model follows them well.

AI must never become the hidden calculator, database authority, or automatic decision-maker.

---

## 3. Two Valid Cloud Roles

Chapter 20 allows the user to choose local or cloud routing for an individual prompt. This chapter adds a second and more important cloud role: **Teacher Mode**.

### 3.1 Cloud Answer Mode

Cloud Answer Mode is a direct user-selected request.

Example:
- The user chooses Gemini / Vertex for one difficult research question.
- The user asks for a complex strategy review.
- The user deliberately wants a stronger cloud answer.

Rules:
- The user knows cloud AI is being used.
- The UI clearly indicates the selected provider.
- Requests pass through a secure server-side proxy.
- The app sends only the context required for that request.
- The answer does not automatically modify app data.

### 3.2 Cloud Teacher Mode

Cloud Teacher Mode is not normal chat routing.

It is a controlled improvement workflow used by the user or developer to make local AI more reliable over time.

Vertex may be asked to:

- Create a reusable logic pattern for a specific app task.
- Produce strong example answers from a safe fact package.
- Identify missing rules or unsafe assumptions.
- Create normal, difficult, incomplete, and ambiguous test cases.
- Compare a local AI answer against a quality rubric.
- Explain why the local answer failed.
- Suggest an improvement to a prompt, Logic Card, or response format.
- Help create approved training material for a future local model.

Teacher Mode must never silently run in the background or turn every user conversation into cloud training material.

---

## 4. The Universal Intelligence Loop

Every POS app using AI should follow this controlled loop:

```text
1. App prepares a structured Fact Package
                ↓
2. Local AI gives the normal user-facing answer
                ↓
3. User accepts, edits, saves, or rejects the answer
                ↓
4. Selected cases enter a Learning Record
                ↓
5. User/developer may send a safe selected case to Vertex Teacher Mode
                ↓
6. Vertex creates or improves:
   - Logic Cards
   - examples
   - edge cases
   - quality rubrics
                ↓
7. Human reviews and approves the result
                ↓
8. Approved knowledge enters the Local Learning Library
                ↓
9. Local AI uses the approved pattern in future relevant requests
                ↓
10. After enough approved examples:
    training export → evaluation → optional local model tuning
```

The approval step is mandatory.

No cloud-generated instruction, example, pattern, or training record becomes active automatically.

---

## 5. The Four Universal Objects

Every app must use the same four conceptual objects. Their content changes by domain, but their purpose remains the same.

### 5.1 Fact Package

A **Fact Package** is a small, structured, app-generated bundle of information given to AI.

It must contain only facts needed to answer the current request.

It should include:

- `domain` — finance, tasks, learning, research, POS, etc.
- `useCase` — the exact requested AI job
- `facts` — relevant known data, calculated by the app
- `limits` — what is missing, uncertain, restricted, or out of scope
- `allowedActions` — read-only, draft-only, save-with-approval, etc.
- `privacyLevel` — local-only, sanitised-for-cloud, or cloud-approved
- `sourceVersion` — app/data version if useful for traceability

Example:

```json
{
  "domain": "task-manager",
  "useCase": "break_down_task",
  "facts": {
    "taskTitle": "Research pharmacy franchise options",
    "deadline": "2026-07-24",
    "status": "in_progress",
    "completedSteps": [
      "List my budget range",
      "Identify target cities"
    ],
    "knownBlocker": "Need three credible franchise options"
  },
  "limits": [
    "Do not invent franchise facts",
    "Do not change deadline",
    "Do not create tasks without user approval"
  ],
  "allowedActions": ["suggest", "draft"],
  "privacyLevel": "local-only"
}
```

Rules:

- The app must calculate all numerical facts itself.
- The AI must not be asked to infer facts that are not present.
- Raw databases, long chat histories, or entire transaction lists must not be sent by default.
- The Fact Package must be as small as possible while still allowing a useful answer.
- The app must clearly state important limitations to the model.

### 5.2 Logic Card

A **Logic Card** is a reusable, approved behaviour pattern for one narrow AI task.

It is not a vague prompt. It is a structured operational lesson that tells local AI how to handle a specific class of request.

Every Logic Card must include:

- Unique ID and version
- Domain and use case
- User goal
- Allowed Fact Package fields
- Required response structure
- Reasoning rules
- Do-not-do rules
- Good examples
- Bad or unsafe examples
- Edge cases
- Quality checklist
- Approval status
- Created/reviewed date

Example use cases:

- Explain an overspending pattern without inventing financial advice.
- Turn a vague task into actionable steps without inventing deadlines.
- Summarise research while separating evidence from assumptions.
- Explain a learning topic at the user’s current level.
- Analyse sales trends without altering stock or financial records.

Logic Cards must be narrow enough to test and improve.

Bad Logic Card:
> Help the user with finance.

Good Logic Card:
> When the user asks why a budget category is over target, explain the app-calculated variance, distinguish one-off from recurring patterns when evidence exists, state data limitations, and suggest review questions without changing budget data.

### 5.3 Learning Record

A **Learning Record** stores what happened during a real AI interaction.

It is the bridge between daily usage and future improvement.

Each record should contain:

- User question or selected quick action
- Fact Package used
- Local model name and version
- Logic Card ID/version used
- Local AI output
- User outcome: accepted, edited, rejected, ignored, saved
- Final user-edited version, if available
- Optional reason for edit/rejection
- Whether the user permits cloud review
- Whether the record is sanitised
- App/version/date metadata

Rules:

- An accepted answer is valuable.
- An edited answer is especially valuable because it shows the preferred improvement.
- A rejected answer is valuable only if the reason is captured.
- Raw user content must not automatically be sent to Vertex.
- The app should support marking a record `local-only`.
- Sensitive domains should default to local-only unless the user explicitly allows cloud review.

### 5.4 Evaluation Pack

An **Evaluation Pack** is a separate collection of test cases used to judge whether the local AI has actually improved.

It must include:

- Normal success cases
- Incomplete-data cases
- Ambiguous cases
- Safety/refusal cases
- Historical failure cases
- Regression cases from previously fixed mistakes
- Expected response characteristics or scoring rubric

Examples:

| Test type | Example |
|---|---|
| Success | “What were my top three expense categories this month?” |
| Missing data | “Compare this month to last month” when last month is unavailable |
| Ambiguous | “Tell me what I should cut” without a clear savings target |
| Safety | “Change my budget automatically based on my spending” |
| Regression | A question that previously caused the model to invent values |

Training records improve the model.  
Evaluation records judge the model.

> **Training data and evaluation data must remain separate.**

A model must not be declared better only because it performs well on examples it has already seen during training or prompt construction.

---

## 6. The Local Learning Library

The **Local Learning Library** is the approved knowledge store used by local AI during normal app use.

It may contain:

- Approved Logic Cards
- Approved example pairs
- Response templates
- Domain vocabulary
- Safe refusal patterns
- User-approved style preferences
- Known mistakes and guardrails
- Relevant evaluation insights

Before generating a normal local answer, the app should retrieve only the most relevant approved Logic Card(s) and examples.

The local model should not receive the whole library in every request.

Rules:

- Retrieve by domain and use case.
- Prefer the newest approved version of a Logic Card.
- Keep context small to protect speed and token limits.
- Log which Logic Card version was used.
- Allow a Logic Card to be disabled immediately if it produces poor behaviour.
- Never allow unapproved drafts into the active library.

This level of improvement comes before fine-tuning.

A good local model with a strong Fact Package and approved Logic Card will often perform better than a poorly directed larger model.

---

## 7. Vertex Teacher Workflow

Vertex Teacher Mode must work through deliberate actions, not hidden automation.

### 7.1 Allowed Teacher Actions

A developer/admin review area may provide actions such as:

- **Create Logic Card Draft**
- **Improve Existing Logic Card**
- **Generate Example Answers**
- **Generate Edge Cases**
- **Create Evaluation Pack**
- **Evaluate Local Answer**
- **Compare Local vs Cloud Answer**
- **Suggest Prompt Improvement**
- **Prepare Sanitised Training Candidates**

Each action must have a clear purpose and must show the selected data before sending.

### 7.2 Required Teacher Input

Every Vertex teacher request must include:

- The exact use case
- The approved Fact Package format
- Privacy classification
- Existing Logic Card, if one exists
- Clear expected output format
- Explicit rules about what Vertex must not assume
- Instruction to avoid personal identifiers unless explicitly approved

### 7.3 Required Teacher Output

Vertex output should be structured wherever possible.

For example, a Logic Card draft request should return:

```json
{
  "logicCardDraft": {
    "title": "",
    "useCase": "",
    "requiredFacts": [],
    "responseStructure": [],
    "reasoningRules": [],
    "doNotDo": [],
    "goodExamples": [],
    "unsafeExamples": [],
    "edgeCases": [],
    "qualityChecklist": []
  },
  "reviewNotes": [],
  "privacyWarnings": []
}
```

The app must show this as a draft for human review.

### 7.4 Human Approval Gate

Before a Vertex-created pattern becomes active, the reviewer must be able to:

- Approve
- Edit and approve
- Reject
- Save as draft
- Mark local-only
- Mark unsuitable for training
- Record a reason

The system must retain version history.

---

## 8. Privacy and Security Rules

Cloud Teacher Mode is powerful, so it requires stricter privacy rules than normal local AI.

### 8.1 Data Minimisation

The system must send the smallest possible amount of information.

Default order of preference:

1. Synthetic example data
2. Sanitised real data
3. Selected minimal real Fact Package
4. Full real data only with explicit user approval

Never send an entire app database, full personal history, or all chat messages merely because Vertex can process them.

### 8.2 Privacy Levels

Every Learning Record and Fact Package should use one of these levels:

| Level | Meaning |
|---|---|
| `local-only` | Must never leave the device/local environment |
| `sanitised-for-cloud` | Identifiers and unnecessary sensitive details have been removed |
| `cloud-approved` | User explicitly permits this selected minimum data to be reviewed by Vertex |
| `synthetic` | Artificial example data with no real user information |

Default recommendation:

- Finance, health, private vault, family information: `local-only`
- Research structures, generic task patterns, learning patterns: `synthetic` or `sanitised-for-cloud`
- Any cloud-approved data: explicit action, visible review, and logging required

### 8.3 Secret Handling

- Vertex credentials must never be placed in frontend JavaScript, HTML, browser storage, screenshots, or Git commits.
- Cloud calls must use a protected backend, serverless function, or Supabase Edge Function.
- Secrets must remain in secure environment configuration.
- Logs must never expose API keys, access tokens, or hidden system instructions.
- The frontend may know that Vertex is available, but it must never own the long-lived secret.

### 8.4 No Silent Writes

Neither local AI nor Vertex may directly write to important app records without a visible user approval step.

This includes:

- Financial records
- Budgets
- Categories
- Goals
- Tasks
- Due dates
- Learning progress
- Research conclusions
- Inventory
- Reports
- Persona settings
- Training library approvals

AI may prepare a draft or recommendation.  
The user or approved deterministic app action must confirm the final write.

---

## 9. Model Improvement Stages

Every app should move through these stages in order.

### Stage 1 — Structured Local AI

Build:

- Local model connection
- Fact Package generator
- Clear system rules
- Read-only/draft-only permissions
- Small response format
- Learning Record logging

Do not start with fine-tuning.

### Stage 2 — Teacher Mode

Build:

- Secure Vertex connection
- Selected-case cloud review
- Logic Card drafting
- Example generation
- Edge-case generation
- Evaluation Pack creation
- Human approval workflow

Vertex remains optional and deliberate.

### Stage 3 — Local Learning Library

Build:

- Approved Logic Card storage
- Relevant pattern retrieval
- Example injection
- Pattern version logging
- Review queue for accepted/edited/rejected answers

At this stage, local AI should improve through better context and approved examples without changing the base model.

### Stage 4 — Evaluation Gate

Before any model tuning:

- Create a stable Evaluation Pack.
- Compare the base local model against the improved prompt/library setup.
- Identify repeated failures.
- Confirm that the failures are model capability problems, not poor data packaging or unclear Logic Cards.

Do not tune a model to fix a problem that a better Fact Package or Logic Card would solve.

### Stage 5 — Optional Local Model Tuning

Only consider tuning when:

- The app has a meaningful number of reviewed examples.
- Approved examples are consistent.
- A separate Evaluation Pack exists.
- The behaviour is stable and narrow enough to define.
- Prompting and Logic Cards have already been tested.
- The expected benefit justifies training complexity.

The tuning process must:

1. Export approved training candidates only.
2. Remove or sanitise sensitive data where needed.
3. Keep training and evaluation sets separate.
4. Compare the base model and tuned model against the same Evaluation Pack.
5. Adopt the tuned model only if it improves usefulness, safety, and consistency.
6. Preserve the ability to return to the previous local model.

No tuned model is automatically trusted merely because training completed successfully.

---

## 10. Universal Guardrails

Every AI implementation in the POS ecosystem must follow these rules:

1. **Facts come from app logic.** AI must not invent, calculate, or overwrite business truth.
2. **Local is the normal operator.** Cloud use must be deliberate, visible, and justified.
3. **Cloud is a teacher, not a hidden controller.**
4. **Minimum data leaves the app.**
5. **Human approval is required** before patterns, examples, or training records become active.
6. **No silent writes** to important records.
7. **Learning Records are not automatically training data.**
8. **Evaluation data stays separate** from training data.
9. **Every active Logic Card is versioned.**
10. **Every model answer is traceable** to its model, Fact Package, and Logic Card where practical.
11. **A local fallback must remain possible** if cloud AI is unavailable, too costly, or not permitted.
12. **User trust is more important than AI cleverness.**

---

## 11. New App AI Checklist

Before AI is added to any new POS app, the developer must answer these questions.

### Product

- What exact user problem will AI solve?
- Which use cases are allowed in the first phase?
- Is AI read-only, draft-only, or able to create user-approved actions?
- What must AI never do?
- What does a useful short answer look like?

### Data

- What facts can app code calculate reliably?
- What is the smallest Fact Package needed?
- Which data is private and local-only?
- Which data can be sanitised for Teacher Mode?
- What must never be sent to Vertex?

### Local AI

- Which local model will be the normal operator?
- Which Logic Cards are required initially?
- How will accepted, edited, and rejected answers be recorded?
- What response format prevents unnecessary long answers?

### Vertex Teacher Mode

- What selected tasks may be sent to Vertex?
- What output format is required?
- Who approves Logic Cards and examples?
- How will the app prevent cloud drafts becoming active automatically?
- Where are credentials protected?

### Quality

- What are the success cases?
- What are the known failure cases?
- What are the safety/refusal cases?
- What will prove that the local model has improved?
- What is the rollback plan if a new pattern causes worse behaviour?

---

## 12. Developer Handoff Requirement

When Claude, Antigravity, or any future developer implements AI in a POS app, they must not jump directly into a generic chat interface or a Vertex API connection.

They must first provide:

1. The proposed AI use cases
2. The Fact Package design
3. Initial Logic Cards
4. Local model behaviour and restrictions
5. Privacy classification
6. Learning Record design
7. Teacher Mode actions
8. Evaluation Pack plan
9. User approval points
10. Rollback and safety plan

Implementation order must be:

```text
Fact Package
→ local read-only/draft-only AI
→ Learning Records
→ approved Logic Cards
→ Teacher Mode
→ Evaluation Pack
→ optional local model tuning
```

A developer must stop for approval after each major stage.

---

## 13. Final Principle

The purpose of this architecture is not to make every app look “AI-powered.”

The purpose is to create a private, reliable intelligence loop:

- The app knows the facts.
- The local model helps daily.
- Vertex helps the system learn better patterns.
- The user decides what is trustworthy.
- The local model gradually becomes more useful without surrendering control, privacy, or product logic.

> **Cloud intelligence creates lessons. Local intelligence applies approved lessons. Human judgement decides what becomes permanent.**
