import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { todayKey, weekOf } from '../lib/dates'
import type { PullRequest, PullRequestRole, PullRequestState } from '../types'

export const PR_PAGE_SIZE = 25

export type PrRoleTab = 'author' | 'review_requested' | 'reviewer' | 'assignee'

export const PR_ROLE_TABS: Array<{ value: PrRoleTab; label: string }> = [
  { value: 'author', label: 'Authored' },
  { value: 'review_requested', label: 'Review requested' },
  { value: 'reviewer', label: 'Reviewed' },
  { value: 'assignee', label: 'Assigned' },
]

export type PrSort = 'created' | 'updated' | 'merged'

export interface PrFilters {
  role: PrRoleTab
  states: PullRequestState[]
  repos: string[]
  from: string | null
  to: string | null
  query: string
  sort: PrSort
}

export const DEFAULT_PR_FILTERS: PrFilters = {
  role: 'author',
  states: [],
  repos: [],
  from: null,
  to: null,
  query: '',
  sort: 'updated',
}

export interface PrSummary {
  createdWeek: number
  createdMonth: number
  merged: number
  avgMergeLabel: string | null
}

export interface PullRequestApi {
  filters: PrFilters
  setFilters: (patch: Partial<PrFilters>) => void
  prs: PullRequest[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  summary: PrSummary | null
  repos: string[]
  refresh: () => void
  loadMore: () => void
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function sameWeekStart(iso: string): boolean {
  const week = weekOf(todayKey())
  const start = week[0].date.getTime()
  const end = week[6].date.getTime() + 86_400_000
  const t = Date.parse(iso)
  return t >= start && t < end
}

function sameMonth(iso: string): boolean {
  const now = new Date()
  const t = new Date(iso)
  return t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth()
}

function formatAvgMerge(ms: number | null): string | null {
  if (ms === null) return null
  const hours = ms / 3_600_000
  if (hours < 1) return '< 1 h'
  if (hours < 48) return `${Math.round(hours)} h`
  const days = hours / 24
  return `${days < 10 ? days.toFixed(1) : Math.round(days)} days`
}

export function usePullRequests(userId: string | undefined, initialFilters?: Partial<PrFilters>): PullRequestApi {
  const [filters, setFiltersState] = useState<PrFilters>(() => ({
    ...DEFAULT_PR_FILTERS,
    ...initialFilters,
  }))
  const [prs, setPrs] = useState<PullRequest[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [summary, setSummary] = useState<PrSummary | null>(null)
  const [repos, setRepos] = useState<string[]>([])
  const [refreshToken, setRefreshToken] = useState(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const setFilters = useCallback((patch: Partial<PrFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }))
    setPage(1)
  }, [])

  const refresh = useCallback(() => {
    setPage(1)
    setRefreshToken((n) => n + 1)
  }, [])

  const loadMore = useCallback(() => {
    setPage((p) => p + 1)
  }, [])

  // List query
  useEffect(() => {
    if (!userId) {
      setPrs([])
      setTotal(0)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(page === 1)
    setLoadingMore(page > 1)

    void (async () => {
      const limit = page * PR_PAGE_SIZE
      let query = supabase
        .from('github_prs')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .eq('role', filters.role as PullRequestRole)
      if (filters.states.length > 0) query = query.in('state', filters.states)
      if (filters.repos.length > 0) query = query.in('repo_full_name', filters.repos)
      if (filters.from) query = query.gte('created_at_gh', `${filters.from}T00:00:00`)
      if (filters.to) query = query.lte('created_at_gh', `${filters.to}T23:59:59`)
      if (filters.query.trim() !== '') {
        query = query.ilike('title', `%${escapeLike(filters.query.trim())}%`)
      }
      if (filters.sort === 'created') {
        query = query.order('created_at_gh', { ascending: false })
      } else if (filters.sort === 'updated') {
        query = query.order('updated_at_gh', { ascending: false })
      } else {
        query = query.order('merged_at_gh', { ascending: false, nullsFirst: false })
      }
      query = query.order('gh_pr_id', { ascending: false }).range(0, limit - 1)

      const { data, error: fetchError, count } = await query
      if (cancelled || !mountedRef.current) return
      if (fetchError) {
        setError(`Could not load pull requests (${fetchError.message}).`)
      } else {
        setError(null)
        setPrs((data ?? []) as PullRequest[])
        setTotal(count ?? (data?.length ?? 0))
      }
      setLoading(false)
      setLoadingMore(false)
    })()

    return () => {
      cancelled = true
    }
  }, [userId, filters, page, refreshToken])

  // Summary (lightweight aggregate over the same role, capped at 1000 rows)
  useEffect(() => {
    if (!userId) {
      setSummary(null)
      return
    }
    let cancelled = false
    void (async () => {
      const { data, error: fetchError } = await supabase
        .from('github_prs')
        .select('created_at_gh, merged_at_gh, state')
        .eq('user_id', userId)
        .eq('role', filters.role as PullRequestRole)
        .order('created_at_gh', { ascending: false })
        .range(0, 999)
      if (cancelled || !mountedRef.current) return
      if (fetchError || !data) {
        setSummary(null)
        return
      }
      const rows = data as Array<{ created_at_gh: string; merged_at_gh: string | null; state: string }>
      let createdWeek = 0
      let createdMonth = 0
      let merged = 0
      let mergeTotalMs = 0
      let mergeCount = 0
      for (const row of rows) {
        if (sameWeekStart(row.created_at_gh)) createdWeek += 1
        if (sameMonth(row.created_at_gh)) createdMonth += 1
        if (row.state === 'merged') {
          merged += 1
          if (row.merged_at_gh) {
            const delta = Date.parse(row.merged_at_gh) - Date.parse(row.created_at_gh)
            if (!Number.isNaN(delta) && delta >= 0) {
              mergeTotalMs += delta
              mergeCount += 1
            }
          }
        }
      }
      setSummary({
        createdWeek,
        createdMonth,
        merged,
        avgMergeLabel: mergeCount > 0 ? formatAvgMerge(mergeTotalMs / mergeCount) : null,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [userId, filters.role, refreshToken])

  // Distinct repositories for the multi-select
  useEffect(() => {
    if (!userId) {
      setRepos([])
      return
    }
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('github_prs')
        .select('repo_full_name')
        .eq('user_id', userId)
        .order('repo_full_name', { ascending: true })
        .limit(500)
      if (cancelled || !mountedRef.current) return
      const names = new Set<string>()
      for (const row of data ?? []) {
        const name = (row as { repo_full_name: string }).repo_full_name
        names.add(name)
      }
      setRepos([...names])
    })()
    return () => {
      cancelled = true
    }
  }, [userId, refreshToken])

  // Realtime: refresh when sync writes new data
  useEffect(() => {
    if (!userId) return
    let timer: number | null = null
    const channel = supabase
      .channel(`github-prs-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'github_prs', filter: `user_id=eq.${userId}` },
        (_payload: RealtimePostgresChangesPayload<PullRequest>) => {
          if (timer !== null) window.clearTimeout(timer)
          timer = window.setTimeout(() => {
            if (mountedRef.current) setRefreshToken((n) => n + 1)
          }, 600)
        },
      )
      .subscribe()
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [userId])

  const hasMore = prs.length < total

  return useMemo(
    () => ({
      filters,
      setFilters,
      prs,
      total,
      loading,
      loadingMore,
      error,
      hasMore,
      summary,
      repos,
      refresh,
      loadMore,
    }),
    [filters, setFilters, prs, total, loading, loadingMore, error, hasMore, summary, repos, refresh, loadMore],
  )
}

export interface DailyActivityItem {
  pr: PullRequest
  activities: Array<'created' | 'merged' | 'updated'>
}

/**
 * Pull requests with created/merged/updated activity on `dateKey`
 * (local calendar day).
 */
export function useDailyGithubActivity(userId: string | undefined, dateKey: string): {
  items: DailyActivityItem[]
  loading: boolean
} {
  const [items, setItems] = useState<DailyActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!userId) {
      setItems([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const start = `${dateKey}T00:00:00`
      const end = `${dateKey}T23:59:59.999`
      const range = (column: string) => `and(${column}.gte.${start},${column}.lte.${end})`
      const { data, error: fetchError } = await supabase
        .from('github_prs')
        .select('*')
        .eq('user_id', userId)
        .or(
          `${range('created_at_gh')},${range('merged_at_gh')},${range('updated_at_gh')}`,
        )
        .order('updated_at_gh', { ascending: false })
        .limit(50)
      if (cancelled || !mountedRef.current) return
      if (fetchError || !data) {
        setItems([])
        setLoading(false)
        return
      }
      const dayStart = Date.parse(start)
      const dayEnd = Date.parse(end)
      const result: DailyActivityItem[] = []
      const seen = new Set<string>()
      for (const raw of data as PullRequest[]) {
        if (seen.has(raw.id)) continue
        seen.add(raw.id)
        const activities: DailyActivityItem['activities'] = []
        if (Date.parse(raw.created_at_gh) >= dayStart && Date.parse(raw.created_at_gh) <= dayEnd) {
          activities.push('created')
        }
        if (raw.merged_at_gh && Date.parse(raw.merged_at_gh) >= dayStart && Date.parse(raw.merged_at_gh) <= dayEnd) {
          activities.push('merged')
        }
        if (
          !activities.includes('created') &&
          !activities.includes('merged') &&
          Date.parse(raw.updated_at_gh) >= dayStart &&
          Date.parse(raw.updated_at_gh) <= dayEnd
        ) {
          activities.push('updated')
        }
        if (activities.length > 0) result.push({ pr: raw, activities })
      }
      setItems(result)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [userId, dateKey])

  return { items, loading }
}
