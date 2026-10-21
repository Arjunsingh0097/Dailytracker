// Client-side helpers for the GitHub Edge Functions.
// The browser never talks to the GitHub API — it only calls our functions,
// which hold the encrypted tokens. Tokens are sent once at connect time
// and never stored, logged, or read back.

import { supabase } from './supabase'
import type { GithubConnection } from '../types'

export class GithubFunctionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GithubFunctionError'
  }
}

async function userAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new GithubFunctionError('Sign in to use GitHub features.')
  return session.access_token
}

async function errorFromResponse(res: Response): Promise<string> {
  try {
    const text = await res.text()
    const parsed: unknown = JSON.parse(text)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'error' in parsed &&
      typeof (parsed as { error: unknown }).error === 'string'
    ) {
      return (parsed as { error: string }).error
    }
  } catch {
    // fall through to the generic message
  }
  if (res.status === 401) return 'Your session has expired. Sign in again and retry.'
  if (res.status === 429) return 'GitHub is rate limiting requests. Try again in a few minutes.'
  return 'Could not reach the server. Check your connection and try again.'
}

/** Call a GitHub edge function with the user's JWT. */
export async function callGithubFunction<T>(name: string, body: unknown): Promise<T> {
  const token = await userAccessToken()
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${token}` },
  })
  if (error) {
    const context = (error as { context?: Response }).context
    if (context && typeof context.status === 'number') {
      throw new GithubFunctionError(await errorFromResponse(context))
    }
    throw new GithubFunctionError('Could not reach the server. Check your connection and try again.')
  }
  return data as T
}

export interface ConnectResult {
  connection: GithubConnection
  warning: string | null
  replaced: boolean
}

export function githubConnect(token: string, label: string): Promise<ConnectResult> {
  return callGithubFunction<ConnectResult>('github-connect', { token, label })
}

export function githubDisconnect(connectionId: string): Promise<{ ok: boolean }> {
  return callGithubFunction<{ ok: boolean }>('github-disconnect', { connection_id: connectionId })
}

export interface SyncDone {
  type: 'done'
  totalFetched: number
  summaries: Array<{ connection_id: string; fetched: number; status: string }>
  errors: Array<{ connection_id: string; message: string }>
}

interface SyncProgress {
  type: 'progress'
  message: string
}

interface SyncError {
  type: 'error'
  error: string
}

export interface SyncStreamResult {
  done: SyncDone | null
  fatalError: string | null
}

/**
 * Run a sync, streaming NDJSON progress events from the Edge Function so
 * the UI can show live status ("Fetched 240 pull requests…").
 */
export async function streamGithubSync(options: {
  mode: 'full' | 'incremental'
  connectionId?: string
  onProgress: (message: string) => void
  signal?: AbortSignal
}): Promise<SyncStreamResult> {
  const accessToken = await userAccessToken()
  const url = `${import.meta.env.SUPABASE_URL}/functions/v1/github-sync`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: import.meta.env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: options.mode,
        ...(options.connectionId ? { connection_id: options.connectionId } : {}),
      }),
      signal: options.signal,
    })
  } catch {
    if (options.signal?.aborted) return { done: null, fatalError: null }
    throw new GithubFunctionError('Could not reach the server. Check your connection and try again.')
  }

  if (!res.ok) {
    throw new GithubFunctionError(await errorFromResponse(res))
  }
  if (!res.body) {
    throw new GithubFunctionError('Sync returned an empty response. Try again.')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let done: SyncDone | null = null
  let fatalError: string | null = null

  for (;;) {
    const { done: readerDone, value } = await reader.read()
    if (readerDone) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      let event: SyncProgress | SyncDone | SyncError
      try {
        event = JSON.parse(trimmed) as SyncProgress | SyncDone | SyncError
      } catch {
        continue
      }
      if (event.type === 'progress') {
        options.onProgress(event.message)
      } else if (event.type === 'done') {
        done = event
      } else if (event.type === 'error') {
        fatalError = event.error
      }
    }
  }

  if (fatalError !== null) throw new GithubFunctionError(fatalError)
  if (done === null) throw new GithubFunctionError('Sync ended unexpectedly. Try again.')
  return { done, fatalError: null }
}
