import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

// Allow strict CORS for the production app origin (and local dev)
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://atlas.abhisheksikka.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Each Atlas voice profile maps to a real Google Cloud TTS voice. The
// languageCode MUST match the voice's own locale prefix -- Google's API
// rejects (or silently mismatches) a voice name paired with the wrong
// language code, which is what broke atlas_calm (en-IN-Neural2-B was
// being sent with languageCode 'en-US').
const VOICE_MAP: Record<string, { name: string; languageCode: string }> = {
  atlas_calm: { name: 'en-IN-Neural2-B', languageCode: 'en-IN' }, // Male, Indian English
  atlas_clear: { name: 'en-US-Neural2-D', languageCode: 'en-US' }, // Male, Global English
};

function base64url(input: string | Uint8Array): string {
  let base64: string;
  if (typeof input === 'string') {
    base64 = btoa(input);
  } else {
    let binary = '';
    for (let i = 0; i < input.length; i++) binary += String.fromCharCode(input[i]);
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Native Web Crypto signed-JWT -> OAuth2 token exchange for a Google Cloud
// service account. Deliberately not using the npm google-auth-library SDK
// here -- it's a heavy, Node-oriented dependency chain (gaxios,
// gcp-metadata, etc.) that is a known source of import/runtime failures in
// Supabase's Deno Edge runtime. This uses only Deno's native Web Crypto API
// and fetch, both first-class in this environment, and is the standard
// pattern for this exact scenario.
async function getGoogleAccessToken(gcpKey: { client_email: string; private_key: string }): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: gcpKey.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;

  const keyData = pemToArrayBuffer(gcpKey.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64url(new Uint8Array(signature))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google OAuth token exchange failed: ${errText}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

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

    // Map allowed voice profiles to actual Google voice + matching language code
    const voiceConfig = VOICE_MAP[voice_profile];
    if (!voiceConfig) {
      return new Response(JSON.stringify({ error: 'Invalid voice_profile' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`TTS Request: user=${user.id} voice=${voiceConfig.name} chars=${text.length}`);

    // 4. Authenticate with Google Cloud
    const gcpKeyString = Deno.env.get('GCP_SERVICE_ACCOUNT_KEY');
    if (!gcpKeyString) {
      throw new Error('GCP_SERVICE_ACCOUNT_KEY secret not found in environment');
    }
    const gcpKey = JSON.parse(gcpKeyString);
    const accessToken = await getGoogleAccessToken(gcpKey);

    // 5. Call Google Cloud TTS API
    const ttsResponse = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: voiceConfig.languageCode, name: voiceConfig.name },
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
