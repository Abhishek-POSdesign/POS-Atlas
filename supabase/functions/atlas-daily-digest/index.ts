// Atlas — daily "worth knowing" digest.
// Runs once a day at noon IST (pg_cron, see migration 024 + the cron.schedule
// call applied alongside this function's deploy). Two independent jobs live
// here:
//
//   1. INSIGHTS: gather deterministic candidate facts (carried tasks, bills
//      due soon from the shared Finance Manager `recurring` table, yesterday's
//      checklist gaps, sleep/workout trend, quiet projects), ask Gemini to
//      pick and phrase up to 5 worth surfacing, and write them to
//      atlas_ai_insights (one row per day). The model is never trusted to
//      invent a fact, date, or id -- it only ranks + writes copy for facts
//      this function already computed, same "Fact Package" discipline as
//      aiContext.js.
//
//   2. MEMORY: separately, read recent free-text notes (sleep morning_note,
//      workout note, journal body) and ask Gemini whether a genuine recurring
//      "why" pattern is visible across them. If so, append one compact entry
//      to atlas_ai_notebook (source:'auto', type:'pattern'). Once auto
//      entries pile up past a threshold, they're consolidated into one
//      'auto_compact' entry -- mirrors the existing manual Compact action,
//      but only ever touches source:'auto' entries; the user's own
//      pin/session/compact entries are never read or rewritten here.
//
// Both jobs reuse the exact Vertex call shape already proven in pos-partner
// (service-account JWT, same VERTEX_API_KEY_POS secret) rather than routing
// through that function over HTTP, since this runs server-to-server with no
// user session to carry as a bearer token.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FINANCE_PROFILE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const MODEL_ID = 'gemini-3.5-flash-lite'
// True global Vertex AI endpoint: host has NO region prefix (confirmed live,
// 2026-08-06 -- the regional us-central1 host 404s "model not found" for
// this model on this project, the exact same bug already fixed in Biz
// Research Hub / B.tech Learning Hub's vertex-chat function). Do not put a
// region prefix back on the host.

function base64url(arr: Uint8Array): string {
  const binary = String.fromCharCode(...arr)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function getAccessToken(sa: any): Promise<string> {
  const pem = sa.private_key
  const pemHeader = '-----BEGIN PRIVATE KEY-----'
  const pemFooter = '-----END PRIVATE KEY-----'
  const pemContents = pem.substring(pem.indexOf(pemHeader) + pemHeader.length, pem.indexOf(pemFooter))
  const binaryDerString = atob(pemContents.replace(/\s/g, ''))
  const binaryDer = new Uint8Array(binaryDerString.length)
  for (let i = 0; i < binaryDerString.length; i++) binaryDer[i] = binaryDerString.charCodeAt(i)

  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryDer.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const header = { alg: 'RS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now }
  const encoder = new TextEncoder()
  const encodedHeader = base64url(encoder.encode(JSON.stringify(header)))
  const encodedPayload = base64url(encoder.encode(JSON.stringify(payload)))
  const tokenInput = `${encodedHeader}.${encodedPayload}`
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(tokenInput))
  const jwt = `${tokenInput}.${base64url(new Uint8Array(sig))}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  if (!tokenRes.ok) throw new Error(`GCP token exchange failed: ${tokenRes.status} - ${await tokenRes.text()}`)
  return (await tokenRes.json()).access_token
}

async function askGemini(accessToken: string, projectId: string, systemText: string, userText: string): Promise<string> {
  const vertexUrl = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${MODEL_ID}:generateContent`
  const body: any = {
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    systemInstruction: { parts: [{ text: systemText }] },
    generationConfig: { temperature: 0.3 },
  }
  const res = await fetch(vertexUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Vertex error: ${res.status} - ${await res.text()}`)
  const json = await res.json()
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Empty response from Vertex AI')
  return text
}

function parseJsonLoose(text: string): any {
  const cleaned = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim()
  return JSON.parse(cleaned)
}

function istNow(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000)
}
function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return isoDate(d)
}

// Frequencies whose Finance Manager cycle_key format has actually been read
// out of live data and confirmed (2026-08-09): for monthly, quarterly and
// yearly, `cycle_key` is the YYYY-MM of the DUE month. Those are the only
// three frequencies Finance uses today -- there are no weekly or daily
// recurring bills in the system at all.
//
// Anything not in this list deliberately SKIPS the paid-check and the bill
// stays visible. A weekly or daily bill needs a real per-occurrence key, and
// inventing an Atlas-side version of that calculation could mark a genuinely
// unpaid bill as paid and silently hide it -- much worse than re-showing one
// that's already been paid. If Finance ever grows a weekly/daily recurring,
// read its actual cycle-key rule first, then extend this list; don't guess.
const BILL_PAID_CHECK_FREQUENCIES = new Set(['monthly', 'quarterly', 'yearly', 'annual', 'annually'])

// Finance's own key for a given due date, mirrored exactly -- not a second
// Atlas calculation. Only ever called for a frequency in the set above.
function financeCycleKey(dueIso: string): string {
  return dueIso.slice(0, 7)
}

// Minimal "next due date on/after `from`" for a recurring bill. Bills are
// read-only here -- Atlas never writes to Finance Manager's tables. This
// computes the due date only; whether that due cycle has already been PAID is
// a separate check against Finance's own `transactions` bookkeeping (see
// paidCycles below) -- `recurring.start_date` cannot be used as a paid signal,
// confirmed live 2026-08-09 that Finance advances it for some bills and not
// others.
function nextDueOnOrAfter(startDate: string, frequency: string, from: string): string {
  let cur = startDate
  const freq = (frequency || 'monthly').toLowerCase()
  const step = (d: string): string => {
    const dt = new Date(d + 'T00:00:00Z')
    if (freq === 'weekly') dt.setUTCDate(dt.getUTCDate() + 7)
    else if (freq === 'yearly' || freq === 'annual' || freq === 'annually') dt.setUTCFullYear(dt.getUTCFullYear() + 1)
    else if (freq === 'quarterly') dt.setUTCMonth(dt.getUTCMonth() + 3)
    else if (freq === 'daily') dt.setUTCDate(dt.getUTCDate() + 1)
    else dt.setUTCMonth(dt.getUTCMonth() + 1) // monthly, and unknown-frequency fallback
    return isoDate(dt)
  }
  let guard = 0
  while (cur < from && guard < 600) { cur = step(cur); guard++ }
  return cur
}

// Using Deno.serve directly (no std/http import) keeps this function
// self-contained -- matches the other newer functions in this project
// (send-family-push, atlas-tts-proxy).
Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const db = createClient(supabaseUrl, serviceKey)

      const serviceAccountJson = Deno.env.get('VERTEX_API_KEY_POS')
      if (!serviceAccountJson) throw new Error('Missing VERTEX_API_KEY_POS secret')
      const sa = JSON.parse(serviceAccountJson)
      const accessToken = await getAccessToken(sa)

      const today = isoDate(istNow())
      const yesterday = addDays(today, -1)
      const billWindowEnd = addDays(today, 3)
      const trendStart = addDays(today, -7)
      const prevTrendStart = addDays(today, -14)

      // ---------------------------------------------------------------
      // Gather candidate facts (deterministic, code-computed, not model-guessed)
      // ---------------------------------------------------------------
      const candidates: any[] = []

      // Both not_started AND in_progress are gathered, but they are DIFFERENT
      // candidate types and must never be conflated (confirmed live
      // 2026-08-09: a running task was announced as "carried", and then an
      // over-correction that dropped in_progress entirely hid running work
      // that genuinely had been sitting for days -- both wrong).
      //
      // carried_task    = not_started, past its date  -> hasn't been picked up
      // stalled_task    = in_progress, started days ago -> picked up, not finished
      //
      // Neither is a hard "always show" rule. Both are just candidates; the
      // model below decides what's worth surfacing, using the multi-week
      // context in the same prompt. Don't reintroduce a fixed threshold here.
      const { data: openTasks } = await db.from('atlas_tasks')
        .select('id, name, scheduled_date, priority, kind, status, started_at, updated_at')
        .in('status', ['not_started', 'in_progress'])
        .lt('scheduled_date', today)
        .is('deleted_at', null)
        .is('archived_at', null)
        .order('scheduled_date', { ascending: true })
        .limit(15)
      for (const t of openTasks || []) {
        const days = Math.round((new Date(today).getTime() - new Date(t.scheduled_date).getTime()) / 86400000)
        if (days < 1) continue
        if (t.status === 'in_progress') {
          candidates.push({
            id: `task:${t.id}`, type: 'stalled_task', accent: 'amber',
            fact: `Task "${t.name}" (${t.kind || 'task'}) is IN PROGRESS -- he started it but it has been open ${days} day${days === 1 ? '' : 's'} since its scheduled date, priority ${t.priority || 'normal'}. This is running work, NOT untouched work.`,
            ref: { kind: 'task', id: t.id, status: 'in_progress' },
          })
        } else {
          candidates.push({
            id: `task:${t.id}`, type: 'carried_task', accent: 'coral',
            fact: `Task "${t.name}" (${t.kind || 'task'}) has not been started and has been carried ${days} day${days === 1 ? '' : 's'}, priority ${t.priority || 'normal'}.`,
            ref: { kind: 'task', id: t.id, status: 'not_started' },
          })
        }
      }

      const { data: bills } = await db.from('recurring')
        .select('id, local_id, name, amount, category, frequency, start_date')
        .eq('profile_id', FINANCE_PROFILE_ID)
        .eq('active', true)

      // How Finance Manager records "marked paid": a `transactions` row
      // carrying recurring_id (the recurring row's local_id) + cycle_key.
      // Rows with a null cycle_key (legacy, pre-date the field) are skipped
      // rather than having one derived for them -- deriving would be a second
      // Atlas-side version of Finance's rule, and a wrong derivation hides an
      // unpaid bill. Fail open instead.
      const paidSince = addDays(today, -400)
      const { data: paidTxns } = await db.from('transactions')
        .select('recurring_id, cycle_key')
        .eq('profile_id', FINANCE_PROFILE_ID)
        .not('recurring_id', 'is', null)
        .not('cycle_key', 'is', null)
        .gte('date', paidSince)
      const paidCycles = new Set((paidTxns || []).map((t: any) => `${t.recurring_id}|${t.cycle_key}`))

      for (const b of bills || []) {
        if (!b.start_date) continue
        const due = nextDueOnOrAfter(b.start_date, b.frequency, today)
        if (due > billWindowEnd) continue
        const freq = (b.frequency || 'monthly').toLowerCase()
        if (b.local_id && BILL_PAID_CHECK_FREQUENCIES.has(freq)
            && paidCycles.has(`${b.local_id}|${financeCycleKey(due)}`)) continue
        const daysOut = Math.round((new Date(due).getTime() - new Date(today).getTime()) / 86400000)
        candidates.push({
          id: `bill:${b.id}:${due}`, type: 'bill_due', accent: 'amber',
          fact: `Bill "${b.name}" (${b.category || 'uncategorised'}), amount ${b.amount || 'unknown'}, due ${due} (${daysOut <= 0 ? 'today or overdue' : `in ${daysOut} day${daysOut === 1 ? '' : 's'}`}).`,
          // localId + date let the Today page re-run this exact same paid
          // check live, so a bill paid AFTER the noon digest ran disappears
          // the same day instead of tomorrow.
          ref: { kind: 'bill', id: b.id, localId: b.local_id, date: due },
        })
      }

      // Two distinct checklist signals: yesterday's skip (informational,
      // no live recheck possible -- the day is over) and today's morning
      // items still unmarked as of noon (actionable -- this is the one the
      // ticker can watch live and drop the instant Abhishek logs it, per
      // his explicit "if I do the stretches at 6pm, stop showing it" ask).
      // Afternoon/night/sleep blocks aren't flagged for "today" since at
      // noon they genuinely haven't happened yet -- flagging those would be
      // a false positive, not a real gap.
      const dow = new Date(today + 'T00:00:00Z').getUTCDay()
      const { data: clItems } = await db.from('atlas_checklist_items').select('id, name, block, days').is('deleted_at', null).is('archived_at', null).eq('active', true)
      const { data: clHistoryYesterday } = await db.from('atlas_checklist_history').select('item_id, status').eq('entry_date', yesterday)
      const { data: clHistoryToday } = await db.from('atlas_checklist_history').select('item_id, status').eq('entry_date', today)
      const clYesterdayById = new Map((clHistoryYesterday || []).map((h: any) => [h.item_id, h.status]))
      const clTodayById = new Map((clHistoryToday || []).map((h: any) => [h.item_id, h.status]))
      for (const item of clItems || []) {
        const appliesToday = !item.days || item.days.includes(dow)
        if (!appliesToday) continue
        if (clYesterdayById.get(item.id) === 'skipped') {
          candidates.push({
            id: `checklist:${item.id}:${yesterday}`, type: 'checklist_gap', accent: 'amber',
            fact: `Checklist item "${item.name}" (${item.block}) was skipped yesterday (${yesterday}).`,
            ref: { kind: 'checklist_item', id: item.id, date: yesterday },
          })
        }
        if (item.block === 'morning' && !clTodayById.has(item.id)) {
          candidates.push({
            id: `checklist:${item.id}:${today}`, type: 'checklist_pending_today', accent: 'coral',
            fact: `Checklist item "${item.name}" (morning) has not been marked done or skipped yet today.`,
            ref: { kind: 'checklist_item', id: item.id, date: today },
          })
        }
      }

      const { data: sleepRecent } = await db.from('atlas_sleep_logs').select('entry_date, duration_minutes').gte('entry_date', trendStart).lte('entry_date', today)
      const { data: sleepPrev } = await db.from('atlas_sleep_logs').select('entry_date, duration_minutes').gte('entry_date', prevTrendStart).lt('entry_date', trendStart)
      const avg = (rows: any[]) => { const d = (rows || []).filter(r => r.duration_minutes != null).map(r => r.duration_minutes); return d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null }
      const sleepAvgNow = avg(sleepRecent || [])
      const sleepAvgPrev = avg(sleepPrev || [])
      if (sleepAvgNow != null && sleepAvgPrev != null && sleepAvgNow < sleepAvgPrev - 30) {
        candidates.push({
          id: 'sleep_trend', type: 'sleep_trend', accent: 'coral',
          fact: `Average sleep dropped from ${Math.floor(sleepAvgPrev / 60)}h${sleepAvgPrev % 60}m to ${Math.floor(sleepAvgNow / 60)}h${sleepAvgNow % 60}m over the last 7 days vs the 7 before that.`,
          ref: { kind: 'sleep_trend', id: null },
        })
      }

      const { data: workoutRecent } = await db.from('atlas_workout_logs').select('entry_date, day_type').gte('entry_date', trendStart).lte('entry_date', today)
      const workoutDays = (workoutRecent || []).filter(w => w.day_type === 'workout').length
      if (workoutDays === 0) {
        candidates.push({
          id: 'workout_trend', type: 'workout_trend', accent: 'coral',
          fact: `Zero workout days logged in the last 7 days (${trendStart} to ${today}).`,
          ref: { kind: 'workout_trend', id: null },
        })
      }

      const { data: projects } = await db.from('atlas_projects').select('id, name').eq('status', 'running').is('deleted_at', null)
      for (const p of projects || []) {
        const { data: logs } = await db.from('atlas_task_logs').select('entry_date').eq('project_id', p.id).order('entry_date', { ascending: false }).limit(1)
        const { data: notes } = await db.from('atlas_project_notes').select('created_at').eq('project_id', p.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(1)
        const lastLog = logs?.[0]?.entry_date
        const lastNote = notes?.[0]?.created_at ? notes[0].created_at.slice(0, 10) : null
        const last = [lastLog, lastNote].filter(Boolean).sort().pop()
        const daysQuiet = last ? Math.round((new Date(today).getTime() - new Date(last).getTime()) / 86400000) : 999
        if (daysQuiet >= 6) {
          candidates.push({
            id: `project:${p.id}`, type: 'quiet_project', accent: 'lilac',
            fact: `Project "${p.name}" has had no activity in ${daysQuiet} days.`,
            ref: { kind: 'project', id: p.id },
          })
        }
      }

      // ---------------------------------------------------------------
      // Multi-week context. The ranking model is explicitly NOT meant to
      // judge each candidate against a 24-hour snapshot -- Abhishek's own
      // framing: it should look at a few weeks and work out what actually
      // deserves his attention. These aggregates give it that view.
      // ---------------------------------------------------------------
      const ctxStart = addDays(today, -28)
      const [{ data: ctxWorkouts }, { data: ctxSleep }, { data: ctxDone }] = await Promise.all([
        db.from('atlas_workout_logs').select('entry_date, day_type, duration_minutes').gte('entry_date', ctxStart).lte('entry_date', today),
        db.from('atlas_sleep_logs').select('entry_date, duration_minutes, sleep_score').gte('entry_date', ctxStart).lte('entry_date', today),
        db.from('atlas_tasks').select('id, completed_at').eq('status', 'done').gte('completed_at', ctxStart).is('deleted_at', null),
      ])
      const wkDays = (ctxWorkouts || []).filter((w: any) => w.day_type === 'workout').length
      const restDays = (ctxWorkouts || []).filter((w: any) => w.day_type && w.day_type !== 'workout').length
      const slpScores = (ctxSleep || []).filter((s: any) => s.sleep_score != null).map((s: any) => s.sleep_score)
      const slpAvgScore = slpScores.length ? Math.round(slpScores.reduce((a: number, b: number) => a + b, 0) / slpScores.length) : null
      const contextText = [
        `Last 28 days: ${wkDays} workout day(s), ${restDays} rest/recovery day(s) logged.`,
        slpAvgScore != null ? `Average sleep score over that window: ${slpAvgScore}.` : `No sleep scores logged in that window.`,
        `${(ctxDone || []).length} task(s) completed in that window.`,
        `Today is ${today}.`,
      ].join('\n')

      // ---------------------------------------------------------------
      // MEMORY (existing auto-pattern entries) feeds the ranking prompt so
      // today's pick can favor something genuinely new over a repeat.
      // ---------------------------------------------------------------
      const { data: notebookRow } = await db.from('atlas_ai_notebook').select('*').maybeSingle()
      const entries: any[] = notebookRow?.entries || []
      const autoEntries = entries.filter((e: any) => e.source === 'auto')
      const memoryText = autoEntries.length ? autoEntries.map((e: any) => `- ${e.text}`).join('\n') : '(no standing patterns recorded yet)'

      let insightsWritten = 0
      let insightError: string | null = null
      if (candidates.length) {
        const candidateList = candidates.map(c => `[${c.id}] (${c.type}) ${c.fact}`).join('\n')
        const system = `You help pick what's worth telling Abhishek about today, from a fixed list of facts about his tasks, checklist, sleep, workouts, projects, and bills. Rules:
- Choose up to 5 of the listed facts -- the ones most worth his attention today. Aim for 2 to 4 on a normal day. Return an empty array ONLY when every candidate is genuinely trivial; an empty ticker should be rare, not your default.
- JUDGE AGAINST THE MULTI-WEEK CONTEXT, NOT JUST TODAY. A fact is worth surfacing when it stands out against his recent weeks. If he has trained nearly every day this month, one rest day is not news. If sleep is in line with his usual range, it is not news.
- Never invent a fact, number, or date not in the list.
- carried_task and stalled_task are DIFFERENT and must never be conflated. A carried_task was never started. A stalled_task he started and has not finished -- never call it "carried", "untouched" or "not started"; he has been working on it. Say it is still open / still in progress.
- A stalled_task that has been open two or more days past its date is usually worth showing -- that is exactly the kind of thing he wants surfaced. One that only slipped a day generally is not. Use judgement, this is guidance and not a fixed rule.
- For each chosen fact, return:
    * "id" -- the exact [id] from the list.
    * "title" -- a short 2-4 word category label (kept for compatibility; the ticker UI no longer displays it, but future views may).
    * "text" -- the PRIMARY line the ticker shows. Write it as the task/reminder/insight itself, in the fewest words that read naturally when spoken aloud. For a reminder, write it like "Call Mohit at 9 PM" or "Book the hotel". For a plain task, just the task name ("Finish the chapter API"). For a health insight, one clean sentence ("Sleep score dropped to 68 last night").
    * "meta" -- the OPTIONAL muted second line on the ticker. Use this for context the primary shouldn't carry: how many days a task has been carried or has been in progress, which project it belongs to, when a reminder fires, what an insight compares to, why a bill is amber. Leave "meta" as an empty string ("") when there is nothing worth adding. Meta is short (under ~50 chars where possible). Separate multiple bits with " · " (middle-dot with spaces).
    * "discuss" -- the message ABHISHEK sends TO the assistant when he taps this tile. Write it in HIS OWN first-person voice, as a question or request addressed to the assistant -- never as the assistant speaking to him. It is placed straight into his chat box as his outgoing message, so anything phrased as an offer ("Want me to take care of that?") or as an observation about him ("I noticed you skipped...") reads backwards and is wrong. Good: "The electricity bill is due today -- what are my options for handling it?" / "Why has this task been sitting for four days?" / "My sleep dropped this week -- what changed?" / "I keep skipping my evening routine -- how do I fix that?" Bad: "Rs 7792 is due today. Want to take care of that now?" and "I noticed you skipped your Dinner routine. Everything alright?" (both are the assistant talking).
    * Do NOT write "discuss" as an instruction to mark, complete, log or skip anything -- it opens a conversation, it never performs an action.
- Favor facts that connect to a standing pattern below when relevant, but do not fabricate a pattern that isn't listed.
- Reply with ONLY a JSON array, no markdown fence, no commentary: [{"id":"...","title":"...","text":"...","meta":"...","discuss":"..."}]`
        const user = `Standing patterns noticed on past days:\n${memoryText}\n\nRecent multi-week context:\n${contextText}\n\nToday's candidate facts:\n${candidateList}`
        try {
          const raw = await askGemini(accessToken, sa.project_id, system, user)
          const picked = parseJsonLoose(raw)
          const byId = new Map(candidates.map(c => [c.id, c]))
          const items = (Array.isArray(picked) ? picked : [])
            .filter((p: any) => p && byId.has(p.id))
            .slice(0, 5)
            .map((p: any) => {
              const c = byId.get(p.id)
              return {
                id: c.id, type: c.type, accent: c.accent,
                title: String(p.title || c.type).slice(0, 40),
                text: String(p.text || c.fact).slice(0, 200),
                meta: String(p.meta || '').slice(0, 120),
                discuss: String(p.discuss || c.fact).slice(0, 300),
                ref: c.ref,
              }
            })
          await db.from('atlas_ai_insights').upsert({ entry_date: today, items }, { onConflict: 'entry_date' })
          insightsWritten = items.length
        } catch (e) {
          insightError = (e as Error).message
          console.error('[atlas-daily-digest] insight generation failed:', insightError)
        }
      } else {
        await db.from('atlas_ai_insights').upsert({ entry_date: today, items: [] }, { onConflict: 'entry_date' })
      }

      // ---------------------------------------------------------------
      // MEMORY: synthesize a "why" pattern from recent free-text notes.
      // ---------------------------------------------------------------
      let patternWritten = false
      let compacted = false
      const noteWindowStart = addDays(today, -14)
      const [{ data: sleepNotes }, { data: workoutNotes }, { data: journalNotes }] = await Promise.all([
        db.from('atlas_sleep_logs').select('entry_date, morning_note').gte('entry_date', noteWindowStart).not('morning_note', 'is', null),
        db.from('atlas_workout_logs').select('entry_date, note').gte('entry_date', noteWindowStart).not('note', 'is', null),
        db.from('atlas_journal_entries').select('entry_date, body').gte('entry_date', noteWindowStart).is('deleted_at', null),
      ])
      const noteLines = [
        ...(sleepNotes || []).map((n: any) => `${n.entry_date} sleep note: ${n.morning_note}`),
        ...(workoutNotes || []).map((n: any) => `${n.entry_date} workout note: ${n.note}`),
        ...(journalNotes || []).map((n: any) => `${n.entry_date} journal: ${n.body}`),
      ].filter(l => l && l.trim().length > 3)

      if (noteLines.length >= 3) {
        const system = `You read Abhishek's own short personal notes about sleep, workouts, and journal reflections from the last two weeks. Look for a genuine recurring cause-and-effect pattern HE himself described (why sleep was bad or good, why a workout was skipped or strong, how he felt and why). If you find one worth remembering, reply with exactly one plain sentence stating it. If nothing meaningfully recurs, reply with exactly: NONE`
        const user = noteLines.join('\n')
        try {
          const raw = (await askGemini(accessToken, sa.project_id, system, user)).trim()
          if (raw && raw.toUpperCase() !== 'NONE' && raw.length < 400) {
            entries.unshift({ id: crypto.randomUUID(), type: 'pattern', source: 'auto', text: raw, createdAt: Date.now() })
            patternWritten = true
          }
        } catch (e) {
          console.error('[atlas-daily-digest] pattern synthesis failed:', (e as Error).message)
        }
      }

      const autoCount = entries.filter((e: any) => e.source === 'auto').length
      if (autoCount > 6) {
        const toCompact = entries.filter((e: any) => e.source === 'auto')
        const kept = entries.filter((e: any) => e.source !== 'auto')
        const system = `You maintain a compact standing memory of recurring patterns in Abhishek's sleep, workouts, checklist, and mood, based on notes he's written himself. Consolidate the following separate pattern notes into ONE short paragraph (max 6 lines), removing duplicates and keeping only what's still likely true. Reply with just the paragraph, no preamble.`
        const user = toCompact.map((e: any) => `- ${e.text}`).join('\n')
        try {
          const compactText = (await askGemini(accessToken, sa.project_id, system, user)).trim()
          kept.unshift({ id: crypto.randomUUID(), type: 'auto_compact', source: 'auto', text: compactText, createdAt: Date.now() })
          entries.length = 0
          entries.push(...kept)
          compacted = true
        } catch (e) {
          console.error('[atlas-daily-digest] auto-compact failed:', (e as Error).message)
        }
      }

      if (patternWritten || compacted) {
        if (notebookRow) await db.from('atlas_ai_notebook').update({ entries }).eq('id', notebookRow.id)
        else await db.from('atlas_ai_notebook').insert({ entries })
      }

      return new Response(JSON.stringify({
        message: 'ok', today, candidateCount: candidates.length, insightsWritten, patternWritten, compacted, insightError,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
    } catch (error: any) {
      console.error('[atlas-daily-digest] Error:', error.message)
      return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })
    }
  })
