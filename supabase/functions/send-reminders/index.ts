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

    // Find tasks that are due today and the time has passed, but not in push history
    const { data: tasks, error: taskError } = await adminClient
      .from('atlas_tasks')
      .select('*, atlas_push_history(id)')
      .eq('status', 'active')
      .eq('notify_enabled', true)
      .eq('scheduled_date', dateStr)
      .lte('scheduled_time', timeStr)

    if (taskError) {
      throw taskError
    }

    // Filter out tasks that already have a push history entry
    const pendingTasks = tasks.filter((t: any) => !t.atlas_push_history || t.atlas_push_history.length === 0)

    if (pendingTasks.length === 0) {
      return new Response(JSON.stringify({ message: 'No new tasks to notify' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // Setup Web Push
    webpush.setVapidDetails(
      'mailto:atlas-admin@example.com',
      Deno.env.get('ATLAS_VAPID_PUBLIC_KEY')!,
      Deno.env.get('ATLAS_VAPID_PRIVATE_KEY')!
    )

    // We only want to send push to the correct user. 
    // Gather all user IDs that have pending tasks
    const userIds = [...new Set(pendingTasks.map((t: any) => t.project_id))] 
    // Wait, in atlas_tasks there is no user_id, there is project_id. But profiles have user_id. 
    // Actually, pos_push_subscriptions has user_id. We need to join atlas_tasks -> atlas_projects -> profiles?
    // Let's just fetch all subscriptions for the users who own these tasks!
    
    // Actually, in a personal OS where there's only 1 user, we can just fetch ALL subscriptions.
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

    const results = []

    for (const task of pendingTasks) {
      const payload = JSON.stringify({
        title: 'Task Reminder',
        body: task.name,
        data: { url: '/', taskId: task.id },
        icon: './icon-192.png',
        actions: [
          { action: 'complete', title: 'Complete' },
          { action: 'snooze', title: 'Snooze 1h' }
        ]
      })

      let successCount = 0
      for (const sub of subscriptions) {
        // Technically, in a multi-user app we would match sub.user_id to task owner.
        // For Personal OS, we send to all devices of this single user.
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        }
        
        try {
          await webpush.sendNotification(pushSubscription, payload)
          results.push({ success: true, endpoint: sub.endpoint, task: task.name })
          successCount++
        } catch (err: any) {
          console.error('Push error:', err)
          if (err.statusCode === 410 || err.statusCode === 404) {
            await adminClient.from('pos_push_subscriptions').delete().eq('id', sub.id)
          }
          results.push({ success: false, endpoint: sub.endpoint, error: err.message })
        }
      }

      // If at least one push was successful (or even if we attempted it and failed, we might want to log it),
      // we log it to history so we don't spam them every minute if their device is offline.
      // Actually, if it's 410 (unsubscribed), we still want to log it to avoid retrying forever.
      await adminClient.from('atlas_push_history').insert({
        task_id: task.id
      })
    }

    return new Response(JSON.stringify({ message: 'Processed tasks', results }), {
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
