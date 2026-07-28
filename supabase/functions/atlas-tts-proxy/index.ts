import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { JWT } from "npm:google-auth-library";

// Allow strict CORS for the production app origin (and local dev)
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://atlas.abhisheksikka.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Validate Supabase JWT to ensure caller is an authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // 3. Parse and Validate Request Payload
    const { text, voice_profile } = await req.json();

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid or missing text' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Hard limit: 1000 characters
    if (text.length > 1000) {
      console.warn(`Rejected long text request from user ${user.id} (${text.length} chars)`);
      return new Response(JSON.stringify({ error: 'Text exceeds maximum allowed length of 1,000 characters' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Map allowed voice profiles to actual Google voice names
    let voiceName = 'en-IN-Neural2-B'; // Default to Calm (Male Indian English)
    if (voice_profile === 'atlas_clear') {
      voiceName = 'en-US-Journey-D'; // Global English
    } else if (voice_profile !== 'atlas_calm') {
      return new Response(JSON.stringify({ error: 'Invalid voice_profile' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    console.log(`TTS Request: user=${user.id} voice=${voiceName} chars=${text.length}`);

    // 4. Authenticate with Google Cloud
    const gcpKeyString = Deno.env.get('GCP_SERVICE_ACCOUNT_KEY');
    if (!gcpKeyString) {
      throw new Error('GCP_SERVICE_ACCOUNT_KEY secret not found in environment');
    }
    const gcpKey = JSON.parse(gcpKeyString);

    const client = new JWT({
      email: gcpKey.client_email,
      key: gcpKey.private_key,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const accessToken = await client.getAccessToken();

    // 5. Call Google Cloud TTS API
    const ttsResponse = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'en-US', name: voiceName },
        audioConfig: { audioEncoding: 'MP3' }
      })
    });

    if (!ttsResponse.ok) {
      const errorText = await ttsResponse.text();
      console.error('Google TTS Error:', errorText);
      throw new Error('Google TTS API returned an error');
    }

    const ttsData = await ttsResponse.json();
    const audioBase64 = ttsData.audioContent;

    // 6. Return Raw Binary MP3 Stream
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mp3',
        'Content-Length': bytes.length.toString()
      }
    });
  } catch (error) {
    console.error('Edge Function Exception:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
