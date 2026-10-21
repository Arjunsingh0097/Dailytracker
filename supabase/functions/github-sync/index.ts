// github-sync: fetch pull requests for the caller's connections via the
// GitHub Search API, resolve merged state for closed PRs, and upsert the
// results into public.github_prs. Streams NDJSON progress lines so the
// client can show "Fetched N pull requests…" while it runs.
//
// The Search API caps each query at 1000 results, so full syncs split the
// history into created: date windows (recursive bisection) until every
// window fits under the cap. Incremental syncs use updated:>=last_synced.

import { handleCors, withCors } from '../_shared/cors.ts';
import { json, readJsonBody, requireUser, serviceClient } from '../_shared/auth.ts';
import { decryptToken } from '../_shared/crypto.ts';
import {
  GitHubApiError,
  addDaysKey,
  createSearchThrottle,
  dateKey,
  fetchAllSearchResults,
  fetchUpdatedSince,
  getPullDetail,
  mapWithConcurrency,
  repoFullNameFromApiUrl,
  type SearchItem,
} from '../_shared/github.ts';

interface ConnectionRow {
  id: string;
  github_login: string;
  token_expires_at: string | null;
  last_synced_at: string | null;
}

interface SecretRow {
  token_ciphertext: string;
  token_iv: string;
}

interface RoleSpec {
  dbRole: 'author' | 'reviewer' | 'assignee' | 'review_requested';
  qualifier: string;
  label: string;
}

const ROLES: RoleSpec[] = [
  { dbRole: 'author', qualifier: 'author', label: 'authored' },
  { dbRole: 'review_requested', qualifier: 'review-requested', label: 'awaiting your review' },
  { dbRole: 'reviewer', qualifier: 'reviewed-by', label: 'reviewed' },
  { dbRole: 'assignee', qualifier: 'assignee', label: 'assigned' },
];

const UPSERT_BATCH = 200;

interface PrRow {
  user_id: string;
  connection_id: string;
  gh_pr_id: number;
  repo_full_name: string;
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed' | 'merged';
  is_draft: boolean;
  author_login: string | null;
  role: string;
  labels: string[];
  created_at_gh: string;
  updated_at_gh: string;
  closed_at_gh: string | null;
  merged_at_gh: string | null;
}

interface PullResolution {
  state: 'open' | 'closed' | 'merged';
  mergedAt: string | null;
}

function toRow(
  userId: string,
  connectionId: string,
  role: string,
  item: SearchItem,
  detail: PullResolution,
): PrRow {
  return {
    user_id: userId,
    connection_id: connectionId,
    gh_pr_id: item.id,
    repo_full_name: repoFullNameFromApiUrl(item.repository_url),
    number: item.number,
    title: item.title.slice(0, 300),
    html_url: item.html_url,
    state: detail.state,
    is_draft: item.draft === true,
    author_login: item.user?.login ?? null,
    role,
    labels: item.labels.map((label) => label.name).slice(0, 10),
    created_at_gh: item.created_at,
    updated_at_gh: item.updated_at,
    closed_at_gh: item.closed_at,
    merged_at_gh: detail.mergedAt,
  };
}

/**
 * Closed search results do not include merged state; fetch PR detail for
 * closed PRs only, five at a time.
 */
async function resolveStates(
  token: string,
  items: SearchItem[],
  onProgress: (message: string) => void,
): Promise<Map<number, PullResolution>> {
  const resolved = new Map<number, PullResolution>();
  for (const item of items) {
    if (item.state === 'open') resolved.set(item.id, { state: 'open', mergedAt: null });
  }
  const closed = items.filter((item) => item.state === 'closed');
  if (closed.length === 0) return resolved;

  onProgress(
    `Checking merged status on ${closed.length} closed pull request${closed.length === 1 ? '' : 's'}…`,
  );
  let done = 0;
  await mapWithConcurrency(closed, 5, async (item) => {
    const full = repoFullNameFromApiUrl(item.repository_url);
    const [owner, repo] = full.split('/');
    if (!owner || !repo) {
      resolved.set(item.id, { state: 'closed', mergedAt: null });
      return;
    }
    try {
      const detail = await getPullDetail(token, owner, repo, item.number);
      resolved.set(item.id, {
        state: detail.merged ? 'merged' : 'closed',
        mergedAt: detail.merged_at,
      });
    } catch (error) {
      if (
        error instanceof GitHubApiError &&
        (error.code === 'not_found' || error.code === 'unauthorized')
      ) {
        resolved.set(item.id, { state: 'closed', mergedAt: null });
      } else {
        throw error;
      }
    }
    done += 1;
    if (done % 25 === 0 || done === closed.length) {
      onProgress(`Checked ${done} of ${closed.length} closed pull requests…`);
    }
  });
  return resolved;
}

async function setConnectionStatus(
  connectionId: string,
  status: string,
  lastSyncedAt: string | null,
): Promise<void> {
  const supabase = serviceClient();
  const patch: Record<string, unknown> = { status };
  if (lastSyncedAt !== null) patch.last_synced_at = lastSyncedAt;
  await supabase.from('github_connections').update(patch).eq('id', connectionId);
}

function friendlyError(error: unknown, login: string): { message: string; status: string } {
  if (error instanceof GitHubApiError) {
    if (error.code === 'unauthorized' || error.code === 'expired') {
      return {
        status: 'invalid',
        message: `GitHub rejected the token for @${login}. Create a new fine-grained token and reconnect.`,
      };
    }
    if (error.code === 'rate_limited') {
      const retry =
        error.retryAt !== null
          ? ` Retry at ${error.retryAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
          : ' Try again in a few minutes.';
      return { status: 'rate_limited', message: `GitHub is rate limiting requests.${retry}` };
    }
    if (error.code === 'forbidden') {
      return {
        status: 'invalid',
        message: `GitHub denied access for @${login}. ${
          error.message.includes('approve')
            ? 'An organization owner may need to approve the token.'
            : 'Check that the token includes the repositories you selected.'
        }`,
      };
    }
    return { status: 'active', message: error.message };
  }
  if (error instanceof Error) return { status: 'active', message: error.message };
  return { status: 'active', message: 'Sync failed. Try again.' };
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
  const mode = body !== null && body.mode === 'full' ? 'full' : 'incremental';
  const connectionIdFilter =
    typeof body?.connection_id === 'string' && body.connection_id.trim() !== ''
      ? body.connection_id.trim()
      : null;

  const supabase = serviceClient();
  let query = supabase
    .from('github_connections')
    .select('id, github_login, token_expires_at, last_synced_at')
    .eq('user_id', userId);
  if (connectionIdFilter !== null) {
    // An explicit connection may be retried regardless of status.
    query = query.eq('id', connectionIdFilter);
  } else {
    // Bulk sync: healthy connections plus ones that hit a rate limit earlier.
    query = query.in('status', ['active', 'rate_limited']);
  }
  const { data: connections, error: connError } = await query;
  if (connError) {
    return withCors(json({ error: 'Could not load your GitHub connections.' }, 500), req);
  }
  if (!connections || connections.length === 0) {
    return withCors(
      json({ error: 'No active GitHub connection to sync. Connect a token in Settings first.' }, 400),
      req,
    );
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  const send = (payload: Record<string, unknown>): Promise<void> =>
    writer.write(encoder.encode(`${JSON.stringify(payload)}\n`));

  void (async () => {
    const throttle = createSearchThrottle();
    const summaries: Array<{ connection_id: string; fetched: number; status: string }> = [];
    const errors: Array<{ connection_id: string; message: string }> = [];

    try {
      for (const connection of connections as ConnectionRow[]) {
        try {
          if (
            connection.token_expires_at !== null &&
            Date.parse(connection.token_expires_at) <= Date.now()
          ) {
            await setConnectionStatus(connection.id, 'expired', null);
            summaries.push({ connection_id: connection.id, fetched: 0, status: 'expired' });
            errors.push({
              connection_id: connection.id,
              message: `The token for @${connection.github_login} has expired. Create a new fine-grained token and reconnect.`,
            });
            continue;
          }

          const { data: secret, error: secretError } = await supabase
            .from('github_secrets')
            .select('token_ciphertext, token_iv')
            .eq('connection_id', connection.id)
            .single();
          if (secretError || !secret) {
            throw new Error('Could not read the stored token for this connection.');
          }
          const secretRow = secret as SecretRow;
          const token = await decryptToken(secretRow.token_ciphertext, secretRow.token_iv);

          const incremental = mode === 'incremental' && connection.last_synced_at !== null;
          const sinceKey = incremental
            ? addDaysKey(dateKey(new Date(Date.parse(connection.last_synced_at as string))), -2)
            : null;

          const seen = new Set<string>();
          const rows: PrRow[] = [];
          let totalFetched = 0;

          for (const role of ROLES) {
            const baseQuery = `is:pr ${role.qualifier}:${connection.github_login}`;
            await send({
              type: 'progress',
              message: `Fetching pull requests ${role.label} for @${connection.github_login}…`,
            });
            const items = incremental
              ? await fetchUpdatedSince(
                  token,
                  baseQuery,
                  sinceKey as string,
                  (m) => void send({ type: 'progress', message: m }),
                  throttle,
                )
              : await fetchAllSearchResults(
                  token,
                  baseQuery,
                  (m) => void send({ type: 'progress', message: m }),
                  throttle,
                );

            // The same PR can appear twice in one query; dedupe by search item id.
            const unique = new Map<number, SearchItem>();
            for (const item of items) {
              if (!unique.has(item.id)) unique.set(item.id, item);
            }
            const uniqueItems = [...unique.values()];

            const resolutions = await resolveStates(token, uniqueItems, (m) =>
              void send({ type: 'progress', message: m }),
            );

            for (const item of uniqueItems) {
              const resolution = resolutions.get(item.id);
              if (!resolution) continue;
              const key = `${item.id}:${role.dbRole}`;
              if (seen.has(key)) continue;
              seen.add(key);
              rows.push(toRow(userId, connection.id, role.dbRole, item, resolution));
            }
            totalFetched += uniqueItems.length;
            await send({
              type: 'progress',
              message: `Fetched ${totalFetched} pull request${totalFetched === 1 ? '' : 's'} so far…`,
            });
          }

          for (let offset = 0; offset < rows.length; offset += UPSERT_BATCH) {
            const batch = rows.slice(offset, offset + UPSERT_BATCH);
            const { error: upsertError } = await supabase
              .from('github_prs')
              .upsert(batch, { onConflict: 'user_id,gh_pr_id,role' });
            if (upsertError) {
              throw new Error(`Could not save pull requests (${upsertError.message}).`);
            }
          }

          if (mode === 'full') {
            // Drop rows that no longer match any search (role changed, etc.).
            const { data: existing, error: listError } = await supabase
              .from('github_prs')
              .select('id, gh_pr_id, role')
              .eq('connection_id', connection.id);
            if (!listError && existing) {
              const staleIds = existing
                .filter((row) => !seen.has(`${row.gh_pr_id}:${row.role}`))
                .map((row) => row.id as string);
              for (let offset = 0; offset < staleIds.length; offset += UPSERT_BATCH) {
                const batch = staleIds.slice(offset, offset + UPSERT_BATCH);
                await supabase.from('github_prs').delete().in('id', batch);
              }
            }
          }

          const now = new Date().toISOString();
          await setConnectionStatus(connection.id, 'active', now);
          summaries.push({ connection_id: connection.id, fetched: rows.length, status: 'active' });
          await send({
            type: 'progress',
            message: `Saved ${rows.length} pull request${rows.length === 1 ? '' : 's'} for @${connection.github_login}.`,
          });
        } catch (error) {
          const friendly = friendlyError(error, connection.github_login);
          await setConnectionStatus(connection.id, friendly.status, null);
          summaries.push({ connection_id: connection.id, fetched: 0, status: friendly.status });
          errors.push({ connection_id: connection.id, message: friendly.message });
        }
      }

      await send({
        type: 'done',
        totalFetched: summaries.reduce((sum, s) => sum + s.fetched, 0),
        summaries,
        errors,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed unexpectedly.';
      await send({ type: 'error', error: message });
    } finally {
      await writer.close();
    }
  })();

  return withCors(
    new Response(readable, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
      },
    }),
    req,
  );
});
