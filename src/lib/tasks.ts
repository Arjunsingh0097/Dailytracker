// Helpers for creating tracker tasks that link back to a GitHub pull request.

import { supabase } from './supabase'
import type { PullRequest } from '../types'

export interface CreateTaskFromPrResult {
  ok: boolean
  message: string
}

type PrPick = Pick<PullRequest, 'title' | 'repo_full_name' | 'number' | 'html_url'>

/**
 * Create a task for `dateKey` titled "repo#123 title", storing the PR url
 * and title so the task row links back to GitHub. Idempotent per day: adding
 * the same PR twice on the same day is rejected with a friendly message.
 */
export async function createTaskFromPr(
  userId: string,
  dateKey: string,
  pr: PrPick,
): Promise<CreateTaskFromPrResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return { ok: false, message: 'Sign in to add tasks.' }

  const { data: existing, error: existingError } = await supabase
    .from('tasks')
    .select('id, title')
    .eq('user_id', userId)
    .eq('task_date', dateKey)
    .eq('github_pr_url', pr.html_url)
    .limit(1)
  if (existingError) {
    return { ok: false, message: `Could not check existing tasks (${existingError.message}).` }
  }
  if (existing && existing.length > 0) {
    return { ok: false, message: `Already added to this day as “${existing[0].title}”.` }
  }

  const { data: maxRow, error: maxError } = await supabase
    .from('tasks')
    .select('sort_order')
    .eq('user_id', userId)
    .eq('task_date', dateKey)
    .order('sort_order', { ascending: false })
    .limit(1)
  if (maxError) {
    return { ok: false, message: `Could not add task (${maxError.message}).` }
  }
  const nextSort = maxRow && maxRow.length > 0 ? (maxRow[0].sort_order as number) + 1 : 0

  const title = `${pr.repo_full_name}#${pr.number} ${pr.title}`.slice(0, 200)
  const { error: insertError } = await supabase.from('tasks').insert({
    user_id: userId,
    title,
    task_date: dateKey,
    sort_order: nextSort,
    github_pr_url: pr.html_url,
    github_pr_title: pr.title.slice(0, 300),
  })
  if (insertError) {
    return { ok: false, message: `Could not add task (${insertError.message}).` }
  }
  return { ok: true, message: `Added “${title}” to ${dateKey === todayKeyString() ? 'today' : dateKey}.` }
}

function todayKeyString(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
