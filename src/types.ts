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
}

export interface DayStat {
  done: number
  total: number
}
