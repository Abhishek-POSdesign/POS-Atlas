import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // Get the user to ensure they are authenticated
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { title, body, data, test } = await req.json()

    // Setup web-push
    webpush.setVapidDetails(
      'mailto:atlas-admin@example.com',
      Deno.env.get('ATLAS_VAPID_PUBLIC_KEY')!,
      Deno.env.get('ATLAS_VAPID_PRIVATE_KEY')!
    )

    // Fetch user's subscriptions
    // We use a service role client to fetch because the table might be restricted if called via a webhook eventually,
    // but here we just fetch for the current user.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: subscriptions, error: subsError } = await adminClient
      .from('pos_push_subscriptions')
      .select('*')
      .eq('user_id', user.id)

    if (subsError || !subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ error: 'No subscriptions found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const payload = JSON.stringify({
      title: title || 'Atlas Push',
      body: body || 'Test notification',
      data: data || { url: '/' },
      icon: '/icon-192.png'
    })

    const results = []
    for (const sub of subscriptions) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      }
      try {
        await webpush.sendNotification(pushSubscription, payload)
        results.push({ success: true, endpoint: sub.endpoint })
      } catch (err: any) {
        console.error('Push error:', err)
        // If it's a 410 Gone, the subscription is expired/unsubscribed
        if (err.statusCode === 410 || err.statusCode === 404) {
          await adminClient.from('pos_push_subscriptions').delete().eq('id', sub.id)
        }
        results.push({ success: false, endpoint: sub.endpoint, error: err.message })
      }
    }

    return new Response(JSON.stringify({ message: 'Push processed', results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
