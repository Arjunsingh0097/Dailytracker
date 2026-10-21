// github-disconnect: delete a connection. Cascades remove the encrypted
// token (github_secrets) and all cached pull requests (github_prs).

import { handleCors, withCors } from '../_shared/cors.ts';
import { json, readJsonBody, requireUser, serviceClient } from '../_shared/auth.ts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') {
    return withCors(json({ error: 'Method not allowed.' }, 405), req);
  }

  const user = await requireUser(req);
  if (user instanceof Response) return withCors(user, req);
  const userId = user.userId;

  const body = await readJsonBody(req);
  const connectionId = typeof body?.connection_id === 'string' ? body.connection_id.trim() : '';
  if (!UUID_PATTERN.test(connectionId)) {
    return withCors(json({ error: 'That connection does not exist.' }, 400), req);
  }

  const supabase = serviceClient();
  // Ownership check: only the caller's own connections can be removed.
  const { data: existing, error: readError } = await supabase
    .from('github_connections')
    .select('id')
    .eq('id', connectionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (readError) {
    return withCors(json({ error: 'Could not load the connection. Try again.' }, 500), req);
  }
  if (!existing) {
    return withCors(json({ error: 'That connection does not exist.' }, 404), req);
  }

  const { error: deleteError } = await supabase
    .from('github_connections')
    .delete()
    .eq('id', connectionId);
  if (deleteError) {
    return withCors(json({ error: 'Could not disconnect. Try again.' }, 500), req);
  }

  return withCors(json({ ok: true }), req);
});
