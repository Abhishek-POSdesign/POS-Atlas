import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase env vars')
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    // Check IST Silent Period (5 AM to 12 PM)
    const nowUtc = new Date()
    const nowIST = new Date(nowUtc.getTime() + 5.5 * 60 * 60 * 1000)
    const hourIST = nowIST.getUTCHours()

    if (hourIST >= 5 && hourIST < 12) {
      console.log('Silent period active (IST). Skipping notifications.')
      return new Response(JSON.stringify({ message: 'Silent period active' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // Get current date/time strings for comparison
    const dateStr = nowIST.toISOString().split('T')[0]
    // Time formatted as HH:MM:SS
    const timeStr = nowIST.toISOString().split('T')[1].split('.')[0]

    webpush.setVapidDetails(
      'mailto:atlas-admin@example.com',
      Deno.env.get('ATLAS_VAPID_PUBLIC_KEY')!,
      Deno.env.get('ATLAS_VAPID_PRIVATE_KEY')!
    )

    const { data: subscriptions, error: subError } = await adminClient
      .from('pos_push_subscriptions')
      .select('*')

    if (subError) throw subError

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: 'No push subscriptions found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    async function sendToAllSubs(payload: string) {
      const sendResults = []
      for (const sub of subscriptions!) {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }
        try {
          await webpush.sendNotification(pushSubscription, payload)
          sendResults.push({ success: true, endpoint: sub.endpoint })
        } catch (err: any) {
          console.error('Push error:', err)
          if (err.statusCode === 410 || err.statusCode === 404) {
            await adminClient.from('pos_push_subscriptions').delete().eq('id', sub.id)
          }
          sendResults.push({ success: false, endpoint: sub.endpoint, error: err.message })
        }
      }
      return sendResults
    }

    const results: any[] = []

    // ---- Tasks & reminders ----
    // Dedup is per-day (sent_date), not "any push_history row ever" -- a
    // task/reminder notified today is skipped today, but is eligible again
    // tomorrow if still pending, and (the actual bug fix) a snooze that
    // moves scheduled_date/scheduled_time to a new slot is never
    // permanently locked out by an old notification from before the snooze.
    const { data: tasks, error: taskError } = await adminClient
      .from('atlas_tasks')
      .select('*, atlas_push_history(id)')
      .in('status', ['not_started', 'in_progress'])
      .eq('notify_enabled', true)
      .eq('scheduled_date', dateStr)
      .lte('scheduled_time', timeStr)
      .eq('atlas_push_history.sent_date', dateStr)

    if (taskError) throw taskError

    const pendingTasks = (tasks || []).filter((t: any) => !t.atlas_push_history || t.atlas_push_history.length === 0)

    for (const task of pendingTasks) {
      const payload = JSON.stringify({
        title: 'Task Reminder',
        body: task.name,
        data: { url: '/', taskId: task.id },
        icon: './icon-192.png',
        actions: [
          { action: 'complete', title: 'Complete' },
          { action: 'snooze', title: 'Snooze' }
        ]
      })
      const sendResults = await sendToAllSubs(payload)
      const successCount = sendResults.filter(r => r.success).length
      results.push({ type: 'task', task: task.name, sendResults })

      // Only log as sent if delivery actually succeeded at least once --
      // an unconditional log here would permanently exclude this task from
      // ever notifying again (same class of bug as the dedup fix above).
      if (successCount > 0) {
        await adminClient.from('atlas_push_history').insert({ task_id: task.id, sent_date: dateStr })
      }
    }

    // ---- Checklist items (per-item opt-in, added 2026-08-06) ----
    // A routine item with notify_enabled=true and a notify_time due now.
    // Same per-day dedup shape as tasks above, own table since checklist
    // items and tasks have separate lifecycles.
    const { data: checklistItems, error: clError } = await adminClient
      .from('atlas_checklist_items')
      .select('*, atlas_checklist_push_history(id)')
      .eq('notify_enabled', true)
      .is('deleted_at', null)
      .is('archived_at', null)
      .not('notify_time', 'is', null)
      .lte('notify_time', timeStr)
      .eq('atlas_checklist_push_history.sent_date', dateStr)

    if (clError) throw clError

    const pendingChecklist = (checklistItems || []).filter((i: any) => !i.atlas_checklist_push_history || i.atlas_checklist_push_history.length === 0)

    for (const item of pendingChecklist) {
      const payload = JSON.stringify({
        title: 'Routine Reminder',
        body: item.name,
        data: { url: '/' },
        icon: './icon-192.png'
      })
      const sendResults = await sendToAllSubs(payload)
      const successCount = sendResults.filter(r => r.success).length
      results.push({ type: 'checklist_item', item: item.name, sendResults })

      if (successCount > 0) {
        await adminClient.from('atlas_checklist_push_history').insert({ item_id: item.id, sent_date: dateStr })
      }
    }

    return new Response(JSON.stringify({ message: 'Processed', taskCount: pendingTasks.length, checklistCount: pendingChecklist.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
