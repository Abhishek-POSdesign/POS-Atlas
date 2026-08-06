import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'

// Sends a real push notification to Ritu's registered device(s) when
// Abhishek saves a note in the Family Health Strip. Added 2026-08-07 --
// before this, a note only ever appeared if Ritu happened to already have
// the family app open (the in-tab Notification calls in family/app.js
// can't fire when no tab is open, and there was no push subscription
// mechanism for her device at all). Mirrors send-push's pattern exactly,
// just targets atlas_family_push_subscriptions instead of
// pos_push_subscriptions -- a different person's device, not Abhishek's.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Only Abhishek's own authenticated session may trigger this --
    // verified via his session JWT, same as send-push.
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { title, body } = await req.json()

    webpush.setVapidDetails(
      'mailto:atlas-admin@example.com',
      Deno.env.get('ATLAS_VAPID_PUBLIC_KEY')!,
      Deno.env.get('ATLAS_VAPID_PRIVATE_KEY')!
    )

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: subscriptions, error: subsError } = await adminClient
      .from('atlas_family_push_subscriptions')
      .select('*')

    if (subsError) throw subsError

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: 'No family subscriptions found -- Ritu has not enabled notifications on her device yet' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const payload = JSON.stringify({
      title: title || 'Note from Abhishek',
      body: body || 'You have a new note.',
      data: { url: '/family/' },
      icon: '/icon-192.png'
    })

    const results = []
    for (const sub of subscriptions) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      }
      try {
        await webpush.sendNotification(pushSubscription, payload)
        results.push({ success: true, endpoint: sub.endpoint })
      } catch (err: any) {
        console.error('Family push error:', err)
        if (err.statusCode === 410 || err.statusCode === 404) {
          await adminClient.from('atlas_family_push_subscriptions').delete().eq('id', sub.id)
        }
        results.push({ success: false, endpoint: sub.endpoint, error: err.message })
      }
    }

    return new Response(JSON.stringify({ message: 'Family push processed', results }), {
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
