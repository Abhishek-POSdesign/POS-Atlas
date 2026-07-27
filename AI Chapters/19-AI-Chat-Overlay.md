# Chapter 19 — AI Chat Overlay Design
> Status: ✅ Approved | July 2026
> Source alignment: 00-Design-Principles, 04-Layout, 07-Interactions, 16-Overlay-System, 18-Notifications

## 1. Why This Chapter Exists

Modern productivity systems benefit heavily from context-aware AI utilities. However, if an AI chat assistant behaves like a generic, blocking popup or an isolated screen, it breaks the core layout flows and interrupts reading. 

The Personal OS (POS) requires a dedicated, non-blocking AI helper panel that can run side-by-side with your workspace, shift the page content elegantly on large screens, preserve existing viewport readability, and save insights directly to your local database without page reloads.

This chapter defines the strict positioning, physics, responsiveness, and style guidelines for the POS AI Chat Overlay.

---

## 2. Philosophy of the AI Chat Layer

The AI Study Buddy (and any future AI helper panel) is **collaborative, persistent, and non-blocking**.

- **Non-blocking (No Backdrop Blur/Dimming):** Unlike drawers or modals, the AI Chat Overlay must NOT dim the page or trap focus. The user should be able to read a lesson, type in a note, click buttons in the workspace, and type in the AI chat panel simultaneously.
- **Context-Bound:** The chat assistant should know exactly where the user is looking. If a user opens the chat from a specific topic, the panel binds to that topic ID. 
- **Action-Led:** It must present contextual short-actions (e.g., "Explain it simply", "Quiz me", "Relate to prototypes") to minimize typing overhead.
- **Output-Focused:** The assistant's output must be actionable. The interface must provide a one-click mechanism to save AI answers directly into the user's permanent Notes Vault.

---

## 3. Placement & Dimensions

The AI panel is a right-docked, full-height flyover.

- **Width:** Locked at **480px** (on viewports ≥ 480px wide) or `92vw` (on smaller screens). 480px is the POS "extended" flyover width, providing enough text column space for multi-paragraph explanations and code snippets.
- **Height:** `100vh` (full viewport height).
- **Z-Index:** Set to `60` (above regular page layers, but below blocking system Modals which sit at `70+` to prevent stacking issues).
- **Border:** A `1px solid var(--border-hairline)` left border anchors it visually to the right screen edge.

---

## 4. Left-Shift Content Layout Rule

A common issue with right-docked side panels is that they overlap page content, forcing text columns to become cramped or unreadable. 

To solve this without breaking the page's grid or squeezing standard line lengths:
- **Below 1536px (Standard Screens):** Overlap is accepted. Since content columns are usually narrow and centered, the panel floats over the margins.
- **At or Above 1536px (Wide Screens):** When the AI panel is opened, the main content container (`#main` or `#workspace`) must shift to the left by exactly **240px** (half the panel width) via a hardware-accelerated transform:
  ```css
  body.ai-open #main {
    transform: translateX(-240px);
    transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  ```
- **Line Length Preservation:** The page width and its `max-width` (e.g., `68ch` readability cap) must NOT change. The column is simply translated left, ensuring reading measures remain perfectly stable.

---

## 5. Visual Styling of Chat Messages

Chat bubbles must follow the strict typography and color rules of the POS.

### Casing & Fonts
- **Sender Labels:** Banned. The tail shape and bubble color alone distinguish the user from the assistant.
- **Body Text:** Executed entirely in `Instrument Sans` (`font-size: 14px`, `line-height: 1.6`).
- **Headers inside Bubbles:** H2 and H3 styles inside AI responses are mapped down to small, bold inline text sizes to avoid breaking layout density.

### Message Bubbles Design
- **User Bubble:**
  - **Background:** Accent Color (`#0d9488` in light mode, `#2dd4bf` in dark mode).
  - **Text:** White (`#ffffff` in light mode, near-black `#0b1512` in dark mode).
  - **Border Radius:** `14px 14px 4px 14px` (creates a small tail indicating the message originates from the right side).
  - **Alignment:** Aligned to the right, `margin-left: auto`, max-width `88%`.
- **Assistant Bubble:**
  - **Background:** Subtle neutral gray/stone tint (`rgba(120, 120, 120, 0.08)`).
  - **Text:** Primary Ink (`var(--text-primary)`).
  - **Border Radius:** `14px 14px 14px 4px` (tail points to the left).
  - **Alignment:** Aligned to the left, `margin-right: auto`, max-width `92%`.

### Thinking Indicator
When generating responses, a subtle, non-distracting animated loader is shown:
- Three small inline dots using `currentColor` and an opacity pulse animation:
  ```css
  @keyframes aiPulse {
    0%, 100% { opacity: 0.25; }
    50% { opacity: 0.9; }
  }
  ```
- No massive loading wheels, progress bars, or flashing text.

---

## 6. Context & Header Actions

The AI Panel Header must be a sticky `shrink-0` layer at the top containing:
- Title: **✨ AI Study Buddy** (bold, 14px).
- Context Badge: A dynamic caption indicating if the AI is bound to a topic (e.g. `About: Topic Title` or `General study help`).
- Close Trigger: A flat `✕` button (`28px` square, border-radius `6px`) that removes the `open` class from the panel and the `ai-open` class from the body.

Below the header, the chat area must immediately expose the quick actions row:
- Flat, low-contrast buttons styled as `bg-accent/10 text-accent` with a snappy hover transition.

---

## 7. Save to Vault Action

Insights generated by AI must not be ephemeral. Below the text entry area:
- A contextual action link `💾 Save last answer` appears dynamically when a response is rendered.
- Clicking this creates a new note in `hub.notes` with the topic ID automatically attached, inserting it as a `learn-log` or `ai` auto-generated note.
- A quick success toast confirms: `"Saved to Vault"`.

---

## 8. Triggers & FAB Physics

The AI Panel is invoked via context buttons on cards or the global Floating Action Button (FAB).

- **FAB Position:** Fixed at `right: 18px` and `bottom: 24px` (above env safe-areas).
- **Interactive Scale:**
  - **Hover:** Snappy scale up (`transform: scale(1.06)`).
  - **Press:** Deflect downward (`transform: scale(0.96)`).
- **Open State:** The FAB is hidden when the AI Panel is fully open to reduce visual clutter.
