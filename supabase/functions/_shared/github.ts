// GitHub REST API helpers with rate-limit awareness.
// All GitHub traffic from this app happens in Edge Functions — never in
// the browser. Tokens are passed in per-call and never logged.

const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
/** Search API allows ~30 requests/minute; stay under that. */
const SEARCH_MIN_INTERVAL_MS = 2200;
/** Longest we are willing to sleep for a rate-limit reset inside one request. */
const MAX_RATE_WAIT_SECONDS = 75;

export type GitHubErrorCode =
  | 'unauthorized'
  | 'expired'
  | 'forbidden'
  | 'rate_limited'
  | 'not_found'
  | 'network'
  | 'server';

export class GitHubApiError extends Error {
  readonly code: GitHubErrorCode;
  readonly status: number;
  readonly retryAt: Date | null;

  constructor(code: GitHubErrorCode, message: string, status = 0, retryAt: Date | null = null) {
    super(message);
    this.name = 'GitHubApiError';
    this.code = code;
    this.status = status;
    this.retryAt = retryAt;
  }
}

export interface RateLimitInfo {
  remaining: number | null;
  resetAt: Date | null;
  retryAfterSeconds: number | null;
}

function parseRateHeaders(res: Response): RateLimitInfo {
  const remainingRaw = res.headers.get('x-ratelimit-remaining');
  const resetRaw = res.headers.get('x-ratelimit-reset');
  const retryAfterRaw = res.headers.get('retry-after');
  const remaining = remainingRaw !== null && /^\d+$/.test(remainingRaw) ? Number(remainingRaw) : null;
  const resetAt =
    resetRaw !== null && /^\d+$/.test(resetRaw)
      ? new Date(Number(resetRaw) * 1000)
      : null;
  const retryAfterSeconds =
    retryAfterRaw !== null && /^\d+$/.test(retryAfterRaw) ? Number(retryAfterRaw) : null;
  return { remaining, resetAt, retryAfterSeconds };
}

function retryAtFrom(rate: RateLimitInfo): Date | null {
  if (rate.retryAfterSeconds !== null) {
    return new Date(Date.now() + rate.retryAfterSeconds * 1000);
  }
  return rate.resetAt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform an authenticated GitHub API request.
 * Throws GitHubApiError on auth failures, rate limits and other errors;
 * returns the Response for the caller to parse on 2xx/404.
 */
export async function githubRequest(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('X-GitHub-Api-Version', API_VERSION);
  headers.set('User-Agent', 'daily-task-tracker');
  // Never follow redirects to arbitrary locations with the token attached.
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, redirect: 'error' });
  } catch {
    throw new GitHubApiError(
      'network',
      'Could not reach GitHub. Check GitHub status and try again shortly.',
    );
  }

  if (res.ok) return res;

  const rate = parseRateHeaders(res);
  const expirationHeader = res.headers.get('github-authentication-token-expiration');
  let bodyMessage = '';
  try {
    const text = await res.text();
    const parsed: unknown = JSON.parse(text);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'message' in parsed &&
      typeof (parsed as { message: unknown }).message === 'string'
    ) {
      bodyMessage = (parsed as { message: string }).message;
    }
  } catch {
    // Body is not JSON; ignore.
  }
  const lower = bodyMessage.toLowerCase();

  if (res.status === 401) {
    if (expirationHeader !== null) {
      throw new GitHubApiError(
        'expired',
        'This token has expired. Create a new fine-grained token in GitHub and reconnect.',
        401,
      );
    }
    throw new GitHubApiError(
      'unauthorized',
      'GitHub rejected this token. It may have been revoked — create a new fine-grained token and reconnect.',
      401,
    );
  }

  if (res.status === 429 || res.status === 403) {
    const isRateLimited =
      res.status === 429 ||
      rate.remaining === 0 ||
      lower.includes('rate limit') ||
      lower.includes('secondary rate limit') ||
      lower.includes('abuse detection');
    if (isRateLimited) {
      throw new GitHubApiError(
        'rate_limited',
        'GitHub is rate limiting requests.',
        res.status,
        retryAtFrom(rate),
      );
    }
    throw new GitHubApiError(
      'forbidden',
      bodyMessage !== ''
        ? `GitHub denied this request: ${bodyMessage}. If the token belongs to an organization, an owner may need to approve it.`
        : 'GitHub denied this request. If the token belongs to an organization, an owner may need to approve it, or it may not include the selected repositories.',
      403,
    );
  }

  if (res.status === 404) {
    throw new GitHubApiError('not_found', bodyMessage || 'Not found on GitHub.', 404);
  }

  throw new GitHubApiError(
    'server',
    bodyMessage !== '' ? `GitHub returned an error: ${bodyMessage}` : 'GitHub had a problem. Try again shortly.',
    res.status,
  );
}

/** Throttle Search API calls to stay under the ~30/min budget. */
export function createSearchThrottle(): () => Promise<void> {
  let lastCallAt = 0;
  return async () => {
    const elapsed = Date.now() - lastCallAt;
    if (elapsed < SEARCH_MIN_INTERVAL_MS) {
      await sleep(SEARCH_MIN_INTERVAL_MS - elapsed);
    }
    lastCallAt = Date.now();
  };
}

/**
 * Wait for a rate-limit window to reset and retry the action once or twice.
 * Throws a friendly rate_limited error when the wait would be too long.
 */
export async function withRateLimitRetry<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.code !== 'rate_limited' || attempt >= 2) {
        throw error;
      }
      const waitMs =
        error.retryAt !== null ? error.retryAt.getTime() - Date.now() : SEARCH_MIN_INTERVAL_MS * 4;
      if (waitMs > MAX_RATE_WAIT_SECONDS * 1000) {
        throw error;
      }
      await sleep(Math.max(waitMs, 1000));
    }
  }
}

export interface SearchItem {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  draft: boolean;
  user: { login: string } | null;
  labels: { name: string }[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  repository_url: string;
}

interface SearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: SearchItem[];
}

export function repoFullNameFromApiUrl(repositoryUrl: string): string {
  const marker = '/repos/';
  const index = repositoryUrl.indexOf(marker);
  if (index === -1) return 'unknown/unknown';
  return repositoryUrl.slice(index + marker.length);
}

async function searchRequest(
  token: string,
  query: string,
  page: number,
  perPage: number,
  throttle: () => Promise<void>,
): Promise<SearchResponse> {
  await throttle();
  const params = new URLSearchParams({
    q: query,
    per_page: String(perPage),
    page: String(page),
    sort: 'updated',
    order: 'desc',
  });
  const res = await withRateLimitRetry(() =>
    githubRequest(token, `/search/issues?${params.toString()}`),
  );
  const parsed: unknown = await res.json();
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as SearchResponse).items)
  ) {
    throw new GitHubApiError('server', 'GitHub search returned an unexpected response.', 500);
  }
  return parsed as SearchResponse;
}

export async function searchCount(
  token: string,
  query: string,
  throttle: () => Promise<void>,
): Promise<number> {
  const data = await searchRequest(token, query, 1, 1, throttle);
  return data.total_count;
}

export async function searchPage(
  token: string,
  query: string,
  page: number,
  perPage: number,
  throttle: () => Promise<void>,
): Promise<SearchItem[]> {
  const data = await searchRequest(token, query, page, perPage, throttle);
  return data.items;
}

export interface PullDetail {
  merged: boolean;
  merged_at: string | null;
  state: 'open' | 'closed';
}

/** Fetch full PR detail (needed for merged_at, which search results omit). */
export async function getPullDetail(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<PullDetail> {
  const res = await withRateLimitRetry(() =>
    githubRequest(token, `/repos/${owner}/${repo}/pulls/${number}`),
  );
  const parsed: unknown = await res.json();
  if (parsed === null || typeof parsed !== 'object') {
    throw new GitHubApiError('server', 'GitHub returned an unexpected response.', 500);
  }
  const detail = parsed as { merged?: unknown; merged_at?: unknown; state?: unknown };
  const mergedAt = typeof detail.merged_at === 'string' ? detail.merged_at : null;
  const merged = detail.merged === true || mergedAt !== null;
  return {
    merged,
    merged_at: mergedAt,
    state: detail.state === 'open' ? 'open' : 'closed',
  };
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Date-window helpers for full syncs (the Search API caps at 1000 results
// per query, so large histories are split into created: windows).
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export function dateKey(utcDate: Date): string {
  return utcDate.toISOString().slice(0, 10);
}

export function addDaysKey(key: string, days: number): string {
  return dateKey(new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS));
}

/**
 * Split [start, end] (inclusive YYYY-MM-DD) into two windows that are both
 * shorter. Returns null when the window is a single day.
 */
export function splitDateWindow(start: string, end: string): [string, string] | null {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const days = Math.floor((endMs - startMs) / DAY_MS);
  if (days < 2) return null;
  const mid = addDaysKey(start, Math.floor(days / 2));
  return [mid, addDaysKey(mid, 1)];
}

/**
 * Fetch every result of a search query by recursively bisecting created:
 * windows whenever a window returns more than 1000 results.
 */
export async function fetchAllSearchResults(
  token: string,
  baseQuery: string,
  onProgress: (message: string) => void,
  throttle: () => Promise<void>,
): Promise<SearchItem[]> {
  const today = dateKey(new Date());
  return await fetchWindow(token, baseQuery, '2008-01-01', today, 0, onProgress, throttle);
}

async function fetchWindow(
  token: string,
  baseQuery: string,
  start: string,
  end: string,
  depth: number,
  onProgress: (message: string) => void,
  throttle: () => Promise<void>,
): Promise<SearchItem[]> {
  const query = `${baseQuery} created:${start}..${end}`;
  const total = await searchCount(token, query, throttle);
  if (total === 0) return [];

  if (total <= 1000) {
    onProgress(`Fetching ${total} pull request${total === 1 ? '' : 's'} (${start} to ${end})…`);
    const items: SearchItem[] = [];
    const pages = Math.ceil(total / 100);
    for (let page = 1; page <= pages; page++) {
      items.push(...(await searchPage(token, query, page, 100, throttle)));
    }
    return items;
  }

  const split = splitDateWindow(start, end);
  if (split === null || depth > 24) {
    onProgress(`Fetching first 1000 pull requests for a very busy day (${start})…`);
    const items: SearchItem[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await searchPage(token, query, page, 100, throttle);
      items.push(...batch);
      if (batch.length < 100) break;
    }
    return items;
  }

  const [leftEnd, rightStart] = split;
  onProgress(`Splitting history: ${start} to ${end} has more than 1000 results…`);
  const left = await fetchWindow(token, baseQuery, start, leftEnd, depth + 1, onProgress, throttle);
  const right = await fetchWindow(
    token,
    baseQuery,
    rightStart,
    end,
    depth + 1,
    onProgress,
    throttle,
  );
  return left.concat(right);
}

/** Fetch results updated since `sinceKey` (YYYY-MM-DD), capped at 1000. */
export async function fetchUpdatedSince(
  token: string,
  baseQuery: string,
  sinceKey: string,
  onProgress: (message: string) => void,
  throttle: () => Promise<void>,
): Promise<SearchItem[]> {
  const query = `${baseQuery} updated:>=${sinceKey}`;
  onProgress(`Fetching pull requests updated since ${sinceKey}…`);
  const items: SearchItem[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await searchPage(token, query, page, 100, throttle);
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}
