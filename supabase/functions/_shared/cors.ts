// Shared CORS handling for GitHub edge functions.
// Origins are restricted to the app via the APP_ORIGINS secret
// (comma-separated). Supports exact origins and https://*.suffix wildcards.

const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://*.vercel.app',
];

function allowedPatterns(): string[] {
  const raw = Deno.env.get('APP_ORIGINS');
  if (!raw || raw.trim() === '') return DEFAULT_ORIGINS;
  return raw
    .split(',')
    .map((entry) => entry.trim().replace(/\/$/, ''))
    .filter((entry) => entry !== '');
}

function originMatches(origin: string, pattern: string): boolean {
  if (origin === pattern) return true;
  if (pattern.startsWith('https://*.')) {
    const suffix = pattern.slice('https://*.'.length);
    if (suffix === '') return false;
    if (!origin.startsWith('https://')) return false;
    const host = origin.slice('https://'.length);
    if (host.includes('/') || host.includes(':')) return false;
    return host.endsWith(`.${suffix}`);
  }
  return false;
}

export function isOriginAllowed(origin: string | null): boolean {
  if (origin === null || origin === '') return true; // non-browser callers (JWT still required)
  return allowedPatterns().some((pattern) => originMatches(origin, pattern));
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin && isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/** Returns a preflight response for OPTIONS requests, or null to continue. */
export function handleCors(req: Request): Response | null {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') {
    if (!isOriginAllowed(origin)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (!isOriginAllowed(origin)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  }
  return null;
}

/** Attach CORS headers to any response before returning it. */
export function withCors(res: Response, req: Request): Response {
  const headers = new Headers(res.headers);
  const cors = corsHeaders(req.headers.get('Origin'));
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
