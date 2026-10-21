// github-connect: validate a fine-grained personal access token, encrypt
// it with AES-256-GCM and store only the ciphertext. The token is read
// from the request once, used for validation, then discarded — it is
// never returned to the client, logged, or stored in plaintext.

import { handleCors, withCors } from '../_shared/cors.ts';
import {
  json,
  readJsonBody,
  requireUser,
  sanitizeLabel,
  serviceClient,
} from '../_shared/auth.ts';
import { encryptToken } from '../_shared/crypto.ts';
import { GitHubApiError, githubRequest } from '../_shared/github.ts';

const MAX_CONNECTIONS = 5;
const FINE_GRAINED_PREFIX = 'github_pat_';
const CLASSIC_PREFIXES = ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'];
const TOKEN_PATTERN = /^github_pat_[A-Za-z0-9_]{20,250}$/;

interface GhUser {
  login: string;
  id: number;
  type?: string;
}

interface GhRepo {
  owner?: { login?: string };
}

function parseExpiration(res: Response): string | null {
  const raw = res.headers.get('github-authentication-token-expiration');
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * Best-effort resource-owner detection: a fine-grained token granted to an
 * organization only sees that organization's repositories, while a personal
 * token also sees the user's own. Falls back to the user login.
 */
async function detectResourceOwner(
  token: string,
  login: string,
): Promise<{ owner: string; accessibleRepoCount: number; manyRepos: boolean }> {
  const res = await githubRequest(token, '/user/repos?per_page=100&affiliation=owner,collaborator,organization_member');
  const repos: GhRepo[] = await res.json();
  if (!Array.isArray(repos)) return { owner: login, accessibleRepoCount: 0, manyRepos: false };
  const owners = new Set<string>();
  for (const repo of repos) {
    const owner = repo.owner?.login;
    if (typeof owner === 'string') owners.add(owner);
  }
  if (owners.size === 1 && !owners.has(login)) {
    return { owner: [...owners][0], accessibleRepoCount: repos.length, manyRepos: repos.length >= 100 };
  }
  return { owner: login, accessibleRepoCount: repos.length, manyRepos: repos.length >= 100 };
}

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
  if (body === null) {
    return withCors(json({ error: 'Request body must be JSON: { token, label? }.' }, 400), req);
  }

  const rawToken = typeof body.token === 'string' ? body.token.trim() : '';
  if (rawToken === '') {
    return withCors(json({ error: 'Paste your GitHub token first.' }, 400), req);
  }
  if (CLASSIC_PREFIXES.some((prefix) => rawToken.startsWith(prefix))) {
    return withCors(
      json({
        error:
          'That is a classic personal access token. Create a fine-grained token instead — it starts with "github_pat_" and can be limited to read-only Pull requests access.',
      }, 400),
      req,
    );
  }
  if (!rawToken.startsWith(FINE_GRAINED_PREFIX)) {
    return withCors(
      json({
        error:
          'Only fine-grained personal access tokens are accepted. They start with "github_pat_".',
      }, 400),
      req,
    );
  }
  if (!TOKEN_PATTERN.test(rawToken)) {
    return withCors(
      json({ error: 'That token does not look valid. Copy it again from GitHub.' }, 400),
      req,
    );
  }

  const label = sanitizeLabel(body.label);
  const tokenLast4 = rawToken.slice(-4);

  // Validate the token against GitHub.
  let ghUser: GhUser;
  let expiresAt: string | null;
  let oauthScopes = '';
  try {
    const res = await githubRequest(rawToken, '/user');
    expiresAt = parseExpiration(res);
    oauthScopes = res.headers.get('x-oauth-scopes') ?? '';
    const parsed: unknown = await res.json();
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof (parsed as GhUser).login !== 'string' ||
      typeof (parsed as GhUser).id !== 'number'
    ) {
      throw new GitHubApiError('server', 'GitHub returned an unexpected response.', 500);
    }
    ghUser = parsed as GhUser;
  } catch (error) {
    if (error instanceof GitHubApiError) {
      const status = error.code === 'rate_limited' ? 429 : 400;
      const message =
        error.code === 'rate_limited'
          ? 'GitHub is rate limiting requests right now. Wait a minute and try again.'
          : error.message;
      return withCors(json({ error: message }, status), req);
    }
    return withCors(
      json({ error: 'Could not reach GitHub. Check your connection and try again.' }, 502),
      req,
    );
  }

  let owner: string;
  let manyRepos = false;
  try {
    const detected = await detectResourceOwner(rawToken, ghUser.login);
    owner = detected.owner;
    manyRepos = detected.manyRepos;
  } catch {
    owner = ghUser.login;
  }

  // The token is no longer needed; nothing below may log or return it.

  const supabase = serviceClient();

  const { data: existingRows, error: existingError } = await supabase
    .from('github_connections')
    .select('id, label, github_login, github_user_id, resource_owner, token_last4, token_expires_at, status, last_synced_at, created_at')
    .eq('user_id', userId)
    .eq('github_user_id', ghUser.id)
    .eq('resource_owner', owner);
  if (existingError) {
    return withCors(json({ error: 'Could not save the connection. Try again.' }, 500), req);
  }
  const existing = existingRows?.[0] ?? null;

  if (existing === null) {
    const { count, error: countError } = await supabase
      .from('github_connections')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (countError) {
      return withCors(json({ error: 'Could not save the connection. Try again.' }, 500), req);
    }
    if ((count ?? 0) >= MAX_CONNECTIONS) {
      return withCors(
        json({
          error: `You can connect up to ${MAX_CONNECTIONS} tokens. Disconnect one before adding another.`,
        }, 400),
        req,
      );
    }
  }

  let encrypted;
  try {
    encrypted = await encryptToken(rawToken);
  } catch {
    return withCors(json({ error: 'Server encryption is not configured. Try again later.' }, 500), req);
  }

  const status = expiresAt !== null && Date.parse(expiresAt) <= Date.now() ? 'expired' : 'active';
  const connectionFields = {
    user_id: userId,
    label,
    github_login: ghUser.login,
    github_user_id: ghUser.id,
    resource_owner: owner,
    token_last4: tokenLast4,
    token_expires_at: expiresAt,
    status,
    last_synced_at: null,
  };

  let connectionId: string;
  if (existing !== null) {
    const { data: updated, error: updateError } = await supabase
      .from('github_connections')
      .update(connectionFields)
      .eq('id', existing.id)
      .select('id')
      .single();
    if (updateError || !updated) {
      return withCors(json({ error: 'Could not save the connection. Try again.' }, 500), req);
    }
    connectionId = updated.id;
    const { error: secretError } = await supabase.from('github_secrets').upsert({
      connection_id: connectionId,
      user_id: userId,
      token_ciphertext: encrypted.ciphertext,
      token_iv: encrypted.iv,
      key_version: encrypted.keyVersion,
    });
    if (secretError) {
      return withCors(json({ error: 'Could not store the encrypted token. Try again.' }, 500), req);
    }
  } else {
    const { data: created, error: insertError } = await supabase
      .from('github_connections')
      .insert(connectionFields)
      .select('id')
      .single();
    if (insertError || !created) {
      return withCors(json({ error: 'Could not save the connection. Try again.' }, 500), req);
    }
    connectionId = created.id;
    const { error: secretError } = await supabase.from('github_secrets').insert({
      connection_id: connectionId,
      user_id: userId,
      token_ciphertext: encrypted.ciphertext,
      token_iv: encrypted.iv,
      key_version: encrypted.keyVersion,
    });
    if (secretError) {
      await supabase.from('github_connections').delete().eq('id', connectionId);
      return withCors(json({ error: 'Could not store the encrypted token. Try again.' }, 500), req);
    }
  }

  const { data: safeRow, error: readError } = await supabase
    .from('github_connections')
    .select('id, label, github_login, github_user_id, resource_owner, token_last4, token_expires_at, status, last_synced_at, created_at')
    .eq('id', connectionId)
    .single();
  if (readError || !safeRow) {
    return withCors(json({ error: 'Could not read the connection back. Refresh and try again.' }, 500), req);
  }

  let warning: string | null = null;
  if (oauthScopes.trim() !== '') {
    warning =
      'This token carries OAuth scopes that are broader than needed. Fine-grained tokens with only Pull requests: Read are safer.';
  } else if (manyRepos) {
    warning =
      'This token can see a lot of repositories. Consider limiting it to only the repositories you want in the tracker.';
  }

  return withCors(
    json({
      connection: safeRow,
      warning,
      replaced: existing !== null,
    }),
    req,
  );
});
