import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

// Speech-to-Text proxy -- built 2026-08-08 to replace the browser's native
// SpeechRecognition API, which turned out to be genuinely unreliable in real
// use (sessions ending themselves regardless of continuous:true, cutting
// sentences off, occasionally picking up Atlas's own spoken reply). This
// mirrors atlas-tts-proxy's exact JWT/OAuth pattern -- same
// GCP_SERVICE_ACCOUNT_KEY secret, same broad cloud-platform scope, just a
// different Google Cloud endpoint. No new credential was needed.
//
// The client records a finished audio clip (MediaRecorder -- reliable,
// well-supported start/stop, no live-session weirdness) and sends it here
// as base64 once; this returns plain transcribed text. No streaming, no
// live partial results -- record, stop, transcribe, review, send, matching
// the same "tap to stop, review before sending" flow already built for the
// old mic.

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://atlas.abhisheksikka.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Generous but bounded -- a base64 audio clip this size is several minutes
// of speech at typical Opus bitrates; well past any real single voice turn,
// just a sanity ceiling against an accidental huge upload.
const MAX_AUDIO_BASE64_CHARS = 15_000_000;

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

// Identical to atlas-tts-proxy's token exchange -- see that function for the
// full rationale on why this is hand-rolled instead of the google-auth-library SDK.
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
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

    const { audio_base64, mime_type } = await req.json();
    if (!audio_base64 || typeof audio_base64 !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid or missing audio_base64' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (audio_base64.length > MAX_AUDIO_BASE64_CHARS) {
      return new Response(JSON.stringify({ error: 'Audio clip too large' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Google's encoding enum keyed off what the browser's MediaRecorder
    // actually produced -- the client always tries audio/webm;codecs=opus
    // first (Chrome/Edge/Android Chrome, Abhishek's primary devices), with
    // audio/mp4 as a fallback for browsers that don't support that mimeType.
    const encoding = (mime_type || '').includes('mp4') ? 'MP3' : 'WEBM_OPUS';

    const gcpKeyString = Deno.env.get('GCP_SERVICE_ACCOUNT_KEY');
    if (!gcpKeyString) {
      throw new Error('GCP_SERVICE_ACCOUNT_KEY secret not found in environment');
    }
    const gcpKey = JSON.parse(gcpKeyString);
    const accessToken = await getGoogleAccessToken(gcpKey);

    const sttResponse = await fetch('https://speech.googleapis.com/v1/speech:recognize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        config: {
          encoding,
          languageCode: 'en-US',
          model: 'latest_long',
          enableAutomaticPunctuation: true
        },
        audio: { content: audio_base64 }
      })
    });

    if (!sttResponse.ok) {
      const errorText = await sttResponse.text();
      console.error('Google STT Error:', errorText);
      throw new Error('Google STT API returned an error');
    }

    const sttData = await sttResponse.json();
    const transcript = (sttData.results || [])
      .map((r: any) => r.alternatives?.[0]?.transcript || '')
      .join(' ')
      .trim();

    console.log(`STT Request: user=${user.id} audioChars=${audio_base64.length} transcriptChars=${transcript.length}`);

    return new Response(JSON.stringify({ text: transcript }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Edge Function Exception:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
