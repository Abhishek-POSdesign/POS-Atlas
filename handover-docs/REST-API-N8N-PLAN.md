# REST API / n8n Integration Plan

**Status:** Future — read-only plan, not yet approved or started.
**Written:** 2026-08-04 by Claude Code (Sonnet 4.6) after a read-only codebase audit.
**Prerequisite:** Push the v84 cache-bump commit before starting any API work.

---

## Context

Atlas is a single-user, client-side-only app. There is no existing API surface — all Supabase access is from the browser using the anon key + a signed-in user JWT. This plan describes how to expose a small, safe API gateway so n8n (or other automation tools) can read and write Atlas data without holding the Supabase service-role key or bypassing RLS.

---

## 1. What useful first automations Atlas should support

| Automation | Direction | Value |
|---|---|---|
| **Daily morning briefing** | Read → n8n → Slack/email | "Here are your 4 tasks for today and any carried ones" |
| **Create a task from anywhere** | n8n write | Text a note, run a shortcut, type in Slack → task appears in Atlas |
| **End-of-day summary** | Read → n8n → anywhere | Tasks completed, carried count — daily close-out |

**Recommended smallest safe v1:** Start with the read endpoint only — `tasks.today`. Proves auth plumbing, useful from day one as a Slack briefing, zero write risk. Add the `tasks.create` write endpoint only after the read endpoint has run successfully for a few days.

---

## 2. Recommended architecture: Supabase Edge Function as API gateway

### Why Edge Functions, not direct Supabase REST or a separate server

| Option | Verdict |
|---|---|
| n8n calls Supabase REST with service-role key | **Rejected.** n8n holds the service-role key, which bypasses all RLS. One leaked credential = everything exposed. |
| n8n calls Supabase REST with a user JWT | **Rejected.** JWTs expire hourly; brittle refresh flow in n8n. First automation to break whenever the token lapses. |
| Separate server (Node/Express on VPS) | **Overkill.** New infra to maintain. Atlas has no server today. |
| **Supabase Edge Function `atlas-api`** | **Recommended.** Already in the project's infrastructure; Deno runtime; service-role key stays as a secret env var only visible inside the function; n8n gets a simple pre-shared bearer token. |

### Data flow

```
n8n
  └─ HTTP Request
       └─ POST https://vcndlorrrtueofzuynvi.supabase.co/functions/v1/atlas-api
            Authorization: Bearer <ATLAS_API_TOKEN>   ← only credential n8n ever holds

  Supabase Edge Function "atlas-api"
    1. Validate Bearer token vs ATLAS_API_SECRET env var (constant-time compare)
    2. Route to handler (tasks.today, tasks.create, ...)
    3. Validate and sanitize input
    4. Check idempotency key (write endpoints only)
    5. Use internal SUPABASE_SERVICE_ROLE_KEY to query/write
    6. Return standardised { ok, data?, error? }

  Supabase DB (atlas_tasks, etc.)
```

`SUPABASE_SERVICE_ROLE_KEY` and `ATLAS_API_SECRET` live only as Supabase Edge Function environment secrets — never committed to git, never visible to n8n.

---

## 3. Security

**How n8n authenticates:**
`Authorization: Bearer <ATLAS_API_TOKEN>` on every request. The token is a random 32-byte hex string (`openssl rand -hex 32`). The Edge Function compares it with `ATLAS_API_SECRET` using constant-time comparison to prevent timing attacks.

**Where secrets live:**
- `ATLAS_API_SECRET` → Supabase Edge Function environment secret (`supabase secrets set`)
- `SUPABASE_SERVICE_ROLE_KEY` → Supabase injects this automatically for its own functions
- `ATLAS_API_TOKEN` → n8n credential store (never in any Atlas file or git)

**How to revoke access:**
Rotate `ATLAS_API_SECRET` via Supabase dashboard or CLI and redeploy the function. n8n fails immediately until you update its stored token. No database change needed.

**Preventing random access:**
The bearer token check in the Edge Function is the gate — a request without the correct token gets `401` before any Supabase call is made. RLS is not the guard here (service-role key bypasses RLS).

**Preventing duplicate task creation:**
Write endpoints require an `idempotency_key` field (caller-supplied UUID, e.g. n8n's `$runId`). The Edge Function checks an `atlas_api_idempotency` table (`key TEXT PRIMARY KEY, created_at TIMESTAMPTZ, response JSONB`). If the key exists within 24 hours, return the cached response without re-writing. A pg_cron job cleans up rows older than 24 hours.

---

## 4. API v1 proposal

All endpoints POST to the single Edge Function `atlas-api`, routed by the `action` field.

---

### Endpoint 1 — `tasks.today` (read)

```
Request body:
{
  "action": "tasks.today",
  "date": "2026-08-04"          // optional, defaults to today (IST)
}

Response:
{
  "ok": true,
  "data": {
    "date": "2026-08-04",
    "tasks": [
      {
        "id": "uuid",
        "name": "Review PR",
        "kind": "task",
        "status": "not_started",
        "priority": "normal",
        "scheduled_time": "14:30",
        "project_name": "Atlas"
      }
    ],
    "carried_count": 1
  }
}
```

Reads `atlas_tasks` where `scheduled_date = date` and `deleted_at IS NULL`. No writes.

---

### Endpoint 2 — `tasks.create` (write)

```
Request body:
{
  "action": "tasks.create",
  "idempotency_key": "uuid-from-n8n",     // required
  "name": "Review Supabase plan",          // required, 1-200 chars
  "scheduled_date": "2026-08-05",          // optional, must be today or future
  "scheduled_time": "20:00",               // optional HH:MM; only with scheduled_date
  "priority": "normal",                    // optional: "normal" | "high"
  "kind": "task"                           // optional: "task" | "reminder"
}

Validation rules:
- name: required, 1–200 chars, stripped of whitespace
- scheduled_date: if provided, must be >= today (IST)
- scheduled_time: only accepted when scheduled_date is also provided
- priority: "normal" or "high" (default "normal")
- kind: "task" or "reminder" (default "task")
- project_id: excluded from v1 — assign via Atlas UI

Response:
{
  "ok": true,
  "data": {
    "id": "uuid",
    "name": "Review Supabase plan",
    "status": "not_started",
    "scheduled_date": "2026-08-05",
    "priority": "normal",
    "created_at": "2026-08-04T..."
  }
}
```

Reads `atlas_api_idempotency` (key check), writes `atlas_tasks` + `atlas_api_idempotency`.

---

### Endpoint 3 — `tasks.summary` (lightweight status check)

```
Request body: { "action": "tasks.summary" }

Response:
{
  "ok": true,
  "data": {
    "today": 4,
    "carried": 1,
    "upcoming_7d": 6
  }
}
```

Read-only. Useful as a health check and as a quick n8n condition gate.

---

**Excluded from v1:** update task, complete task, create project, sleep/workout logging. Higher-risk writes; add in v2 after v1 is proven stable.

---

## 5. Testing and rollout

**Dry-run mode:**
Deploy the Edge Function with `ATLAS_API_TEST_MODE=true`. All write endpoints validate input and return what would have been created, but skip the actual Supabase insert. Build and test n8n workflows against dry-run first.

**Verification checklist before enabling writes:**
- [ ] `tasks.today` returns actual tasks, correct count
- [ ] `tasks.create` with a duplicate `idempotency_key` returns same response, not a second row
- [ ] Wrong bearer token → `401`, no data
- [ ] Invalid date (yesterday) → `400` with clear error message
- [ ] Name over 200 chars → `400`
- [ ] First live create: task with name `"API_TEST — delete me"`, verify in Atlas, immediately soft-delete

---

## 6. Decision required before implementation starts

> **Read-only v1, or include `tasks.create` from day one?**

A read-only v1 (`tasks.today` + `tasks.summary`) is the safest start — build the morning briefing, verify auth is solid, then unlock writes. If you already have a specific first write automation in mind (e.g., "create task from Slack message"), describe the flow and the write endpoint can be scoped tightly around that one use case.

---

## New database table needed

```sql
-- Run before deploying the Edge Function.
CREATE TABLE atlas_api_idempotency (
    key TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- pg_cron cleanup (extend 021_cron_job.sql or add new migration):
SELECT cron.schedule(
  'atlas-api-idempotency-cleanup',
  '0 6 * * *',   -- daily at 6 AM IST
  $$DELETE FROM atlas_api_idempotency WHERE created_at < NOW() - INTERVAL '24 hours'$$
);
```

No RLS needed on this table — it is only ever accessed by the Edge Function's service-role key, never by the browser client.
