import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

// CORS allows both the deployed origin and localhost dev servers. The old
// hardcoded prod-only Access-Control-Allow-Origin blocked all local-dev
// voice testing; matched with atlas-stt-proxy's own dynamic origin picker
// so voice input and voice reply have identical CORS behavior.
// Allowlist, widened 2026-08-09 -- see atlas-stt-proxy for the full
// rationale. The Finance app (finn.abhisheksikka.com) shares this project's
// voice proxies rather than getting duplicates of its own.
const PROD_ORIGIN = 'https://atlas.abhisheksikka.com';
const ALLOWED_ORIGINS = [
  PROD_ORIGIN,
  'https://finn.abhisheksikka.com',
];
const DEV_ORIGIN_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
function pickCorsOrigin(reqOrigin: string | null): string {
  if (!reqOrigin) return PROD_ORIGIN;
  if (ALLOWED_ORIGINS.includes(reqOrigin)) return reqOrigin;
  if (DEV_ORIGIN_PATTERN.test(reqOrigin)) return reqOrigin;
  return PROD_ORIGIN;
}
function buildCorsHeaders(reqOrigin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': pickCorsOrigin(reqOrigin),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    // Lets the browser's fetch() read X-Voice-Truncated off the response --
    // without this, custom response headers are invisible to client JS on a
    // cross-origin request even though the header is actually sent.
    'Access-Control-Expose-Headers': 'X-Voice-Truncated',
  };
}

// Hard ceiling for hands-free use: high enough that Atlas "usually reads
// everything it wrote" (the whole point -- Abhishek wants full replies
// spoken, not clipped), but safely under Google Cloud TTS's own ~5,000
// character input limit on the synchronous synthesize endpoint. A reply
// longer than this is truncated (not rejected) so a very long answer still
// gets spoken in large part rather than the user hearing nothing at all.
const MAX_CHARS = 3000;

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
  const corsHeaders = buildCorsHeaders(req.headers.get('Origin'));
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

    // Hard limit: MAX_CHARS. A reply longer than this is truncated at the
    // last sentence boundary within the limit (not rejected) so hands-free
    // use still hears most of a very long answer instead of nothing.
    let synthText = text;
    let wasTruncated = false;
    if (text.length > MAX_CHARS) {
      console.warn(`Truncating long text request from user ${user.id} (${text.length} chars)`);
      const clipWindow = text.substring(0, MAX_CHARS);
      const match = clipWindow.match(/[\s\S]*[.?!](?=\s|$)/);
      synthText = match ? match[0] : clipWindow;
      wasTruncated = true;
    }

    // Map allowed voice profiles to actual Google voice + matching language code
    const voiceConfig = VOICE_MAP[voice_profile];
    if (!voiceConfig) {
      return new Response(JSON.stringify({ error: 'Invalid voice_profile' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`TTS Request: user=${user.id} voice=${voiceConfig.name} chars=${text.length} truncated=${wasTruncated}`);

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
        input: { text: synthText },
        voice: { languageCode: voiceConfig.languageCode, name: voiceConfig.name },
        audioConfig: { audioEncoding: 'MP3' }
      })
    });

    if (!ttsResponse.ok) {
      const errorText = await ttsResponse.text();
      console.error('Google TTS Error:', ttsResponse.status, errorText);
      // Surface Google's ACTUAL error rather than a generic 500. The sibling
      // STT proxy once failed 100% of the time in production and the cause
      // was invisible for a full debug cycle purely because the real detail
      // was logged server-side and a generic error returned to the UI.
      let friendly = `Google Text-to-Speech returned ${ttsResponse.status}.`;
      if (errorText.includes('SERVICE_DISABLED') || errorText.includes('has not been used in project') || errorText.includes('is disabled')) {
        friendly = 'The Cloud Text-to-Speech API is not enabled on this Google Cloud project. Enable it in the Google Cloud console, wait a minute, then try again.';
      } else if (ttsResponse.status === 403) {
        friendly = 'Google denied the Text-to-Speech request (403). The service account likely lacks permission to call Text-to-Speech.';
      } else if (ttsResponse.status === 400) {
        friendly = 'Google rejected the synthesis request (400). The voice name and language code may not match.';
      }
      return new Response(JSON.stringify({ error: friendly, googleStatus: ttsResponse.status, googleDetail: errorText.slice(0, 600) }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
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
        'Content-Length': bytes.length.toString(),
        'X-Voice-Truncated': wasTruncated ? 'true' : 'false'
      }
    });
  } catch (error) {
    console.error('Edge Function Exception:', error);
    return new Response(JSON.stringify({ error: 'Text-to-Speech failed: ' + ((error as Error).message || 'unknown error') }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
