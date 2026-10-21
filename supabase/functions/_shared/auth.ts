// Shared auth + response helpers for GitHub edge functions.
// The caller's Supabase JWT is verified and user_id is always derived
// from it — never from the request body.

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface AuthedUser {
  userId: string;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Read the bearer token from the Authorization header. Never log it. */
export function bearerToken(req: Request): string {
  const header = req.headers.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * Verify the caller's Supabase JWT with the Auth service and return the
 * user id. Returns a ready-to-send 401 Response when verification fails.
 */
export async function requireUser(req: Request): Promise<AuthedUser | Response> {
  const token = bearerToken(req);
  if (!token) {
    return json({ error: 'Not signed in. Sign in and try again.' }, 401);
  }
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    return json({ error: 'Server is not configured. Try again later.' }, 500);
  }
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return json({ error: 'Your session has expired. Sign in again and retry.' }, 401);
  }
  return { userId: data.user.id };
}

/** Service-role client for Edge Function use only. Never expose to the browser. */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    throw new Error('Server is not configured');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Parse a JSON body defensively; returns null when invalid. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Strip control characters and cap length for user-supplied labels. */
export function sanitizeLabel(raw: unknown, fallback = 'GitHub'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = Array.from(raw)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : ch;
    })
    .join('')
    .trim()
    .slice(0, 60);
  return cleaned === '' ? fallback : cleaned;
}
