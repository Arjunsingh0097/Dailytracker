export interface Task {
  id: string
  user_id: string
  title: string
  task_date: string
  estimate_minutes: number | null
  spent_seconds: number
  timer_started_at: string | null
  is_done: boolean
  done_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
  github_pr_url: string | null
  github_pr_title: string | null
}

export interface DayStat {
  done: number
  total: number
}

export type GithubConnectionStatus = 'active' | 'invalid' | 'expired' | 'rate_limited'

/** Public-safe connection info — the token itself never reaches the client. */
export interface GithubConnection {
  id: string
  user_id: string
  label: string
  github_login: string
  github_user_id: number
  resource_owner: string | null
  token_last4: string
  token_expires_at: string | null
  status: GithubConnectionStatus
  last_synced_at: string | null
  created_at: string
}

export type PullRequestRole = 'author' | 'reviewer' | 'assignee' | 'review_requested'
export type PullRequestState = 'open' | 'merged' | 'closed'

export interface PullRequest {
  id: string
  user_id: string
  connection_id: string
  gh_pr_id: number
  repo_full_name: string
  number: number
  title: string
  html_url: string
  state: PullRequestState
  is_draft: boolean
  author_login: string | null
  role: PullRequestRole
  labels: string[]
  created_at_gh: string
  updated_at_gh: string
  closed_at_gh: string | null
  merged_at_gh: string | null
}
