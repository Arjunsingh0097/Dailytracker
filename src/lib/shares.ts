// Public day-share links: a random UUID capability URL that shows one day's
// tasks to anyone who has it (read-only, no sign-in required).

import { supabase } from './supabase'

export interface SharedTaskRow {
  title: string
  description: string | null
  is_done: boolean
  estimate_minutes: number | null
  spent_seconds: number
  timer_started_at: string | null
  github_pr_url: string | null
  sort_order: number
}

export interface SharedDayData {
  task_date: string
  tasks: SharedTaskRow[]
}

/** Build the absolute public URL for a share token. */
export function buildShareUrl(token: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('share', token)
  return url.toString()
}

/**
 * Read a shared day anonymously (works with no session).
 * Returns null when the token is invalid or was revoked.
 */
export async function fetchSharedDay(token: string): Promise<SharedDayData | null> {
  const { data, error } = await supabase.rpc('get_shared_day', { p_token: token })
  if (error) return null
  if (data === null || typeof data !== 'object') return null
  const parsed = data as { found?: boolean; task_date?: string; tasks?: unknown }
  if (parsed.found !== true || typeof parsed.task_date !== 'string') return null
  return {
    task_date: parsed.task_date,
    tasks: Array.isArray(parsed.tasks) ? (parsed.tasks as SharedTaskRow[]) : [],
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
