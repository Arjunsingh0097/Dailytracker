import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { addDays, weekOf } from '../lib/dates'
import type { DayStat, Task } from '../types'
import { useToasts } from './useToasts'

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.created_at.localeCompare(b.created_at)
  })
}

function replaceTask(tasks: Task[], updated: Task): Task[] {
  const index = tasks.findIndex((t) => t.id === updated.id)
  if (index === -1) return sortTasks([...tasks, updated])
  const next = [...tasks]
  next[index] = updated
  return sortTasks(next)
}

function removeTask(tasks: Task[], id: string): Task[] {
  return tasks.filter((t) => t.id !== id)
}

/** Seconds elapsed on a running task at a given moment. */
function runningExtraSeconds(task: Task, nowMs = Date.now()): number {
  if (!task.timer_started_at) return 0
  const started = Date.parse(task.timer_started_at)
  if (Number.isNaN(started)) return 0
  return Math.max(0, Math.floor((nowMs - started) / 1000))
}

export function useTasks(userId: string | undefined, selectedDate: string) {
  const { showToast } = useToasts()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const snapshotRef = useRef<Task[]>([])
  const mountedRef = useRef(true)

  const week = useMemo(() => weekOf(selectedDate), [selectedDate])
  const rangeStart = week[0].key
  const rangeEnd = week[6].key

  const fetchWeek = useCallback(async () => {
    if (!userId) return
    const { data, error: fetchError } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .gte('task_date', rangeStart)
      .lte('task_date', rangeEnd)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (!mountedRef.current) return
    if (fetchError) {
      setError(
        `Could not load tasks (${fetchError.message}). Check your connection — your data is safe, this is just a refresh problem.`,
      )
    } else {
      setError(null)
      setTasks(data ?? [])
    }
    setLoading(false)
  }, [userId, rangeStart, rangeEnd])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!userId) {
      setTasks([])
      setLoading(false)
      return
    }
    setLoading(true)
    void fetchWeek()
  }, [userId, fetchWeek])

  // Realtime: apply changes from other devices (and echo of our own)
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`tasks-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` },
        (payload: RealtimePostgresChangesPayload<Task>) => {
          setTasks((prev) => {
            if (payload.eventType === 'INSERT' && payload.new) return replaceTask(prev, payload.new as Task)
            if (payload.eventType === 'UPDATE' && payload.new) return replaceTask(prev, payload.new as Task)
            if (payload.eventType === 'DELETE' && payload.old?.id) return removeTask(prev, payload.old.id as string)
            return prev
          })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  /** Run an optimistic mutation with rollback + error toast, then reconcile. */
  const mutate = useCallback(
    async (
      optimistic: (list: Task[]) => Task[],
      request: () => Promise<{ error: { message: string } | null }>,
      failureMessage: string,
    ): Promise<boolean> => {
      let snapshot: Task[] = []
      setTasks((prev) => {
        snapshot = prev
        snapshotRef.current = prev
        return optimistic(prev)
      })
      const { error: mutationError } = await request()
      if (mutationError) {
        setTasks(snapshotRef.current.length ? snapshotRef.current : snapshot)
        showToast({ message: `${failureMessage}: ${mutationError.message}`, type: 'error' })
        return false
      }
      // Reconcile with the server (timer RPCs also affect other rows)
      void fetchWeek()
      return true
    },
    [fetchWeek, showToast],
  )

  const addTask = useCallback(
    async (
      title: string,
      estimateMinutes: number | null,
      link?: { url: string; title: string },
    ) => {
      if (!userId) return false
      const trimmed = title.trim()
      if (!trimmed) return false
      const maxSort = tasks.reduce((max, t) => Math.max(max, t.sort_order), 0)
      const { data, error: insertError } = await supabase
        .from('tasks')
        .insert({
          user_id: userId,
          title: trimmed.slice(0, 200),
          task_date: selectedDate,
          estimate_minutes: estimateMinutes,
          sort_order: maxSort + 1,
          github_pr_url: link?.url ?? null,
          github_pr_title: link?.title ?? null,
        })
        .select()
        .single()
      if (insertError) {
        showToast({ message: `Could not add task: ${insertError.message}`, type: 'error' })
        return false
      }
      if (data) setTasks((prev) => replaceTask(prev, data))
      return true
    },
    [userId, tasks, selectedDate, showToast],
  )

  const updateTaskFields = useCallback(
    async (id: string, patch: { title?: string; estimate_minutes?: number | null }) => {
      const existing = tasks.find((t) => t.id === id)
      return mutate(
        (list) => {
          const index = list.findIndex((t) => t.id === id)
          if (index === -1) return list
          const next = [...list]
          next[index] = { ...next[index], ...patch }
          return next
        },
        async () => {
          const { error } = await supabase.from('tasks').update(patch).eq('id', id).select()
          return { error }
        },
        'Could not save changes',
      ).then((ok) => {
        if (!ok && existing) setTasks((prev) => replaceTask(prev, existing))
        return ok
      })
    },
    [tasks, mutate],
  )

  const toggleDone = useCallback(
    async (task: Task) => {
      if (task.is_done) {
        return mutate(
          (list) => replaceTask(list, { ...task, is_done: false, done_at: null }),
        async () => {
          const { error } = await supabase
            .from('tasks')
            .update({ is_done: false, done_at: null })
            .eq('id', task.id)
            .select()
          return { error }
        },
        'Could not update task',
      )
      }
      return mutate(
        (list) => {
          let next = list
          // Optimistically stop any other running timer client-side as well
          for (const t of list) {
            if (t.id !== task.id && t.timer_started_at) {
              next = replaceTask(next, {
                ...t,
                timer_started_at: null,
                spent_seconds: t.spent_seconds + runningExtraSeconds(t),
              })
            }
          }
          return replaceTask(next, {
            ...task,
            is_done: true,
            done_at: new Date().toISOString(),
            timer_started_at: null,
            spent_seconds: task.spent_seconds + runningExtraSeconds(task),
          })
        },
        async () => {
          const { error } = await supabase.rpc('complete_task', { task_id: task.id })
          return { error }
        },
        'Could not mark task done',
      )
    },
    [mutate],
  )

  const deleteTask = useCallback(
    async (task: Task) => {
      const ok = await mutate(
        (list) => removeTask(list, task.id),
        async () => {
          const { error } = await supabase.from('tasks').delete().eq('id', task.id)
          return { error }
        },
        'Could not delete task',
      )
      if (ok) {
        showToast({
          message: `Deleted “${task.title}”`,
          type: 'info',
          action: {
            label: 'Undo',
            onClick: () => {
              void (async () => {
                const { error: restoreError } = await supabase.from('tasks').insert({
                  id: task.id,
                  user_id: task.user_id,
                  title: task.title,
                  task_date: task.task_date,
                  estimate_minutes: task.estimate_minutes,
                  spent_seconds: task.spent_seconds,
                  timer_started_at: task.timer_started_at,
                  is_done: task.is_done,
                  done_at: task.done_at,
                  sort_order: task.sort_order,
                })
                if (restoreError) {
                  showToast({ message: `Could not undo delete: ${restoreError.message}`, type: 'error' })
                } else {
                  void fetchWeek()
                }
              })()
            },
          },
        })
      }
      return ok
    },
    [mutate, showToast, fetchWeek],
  )

  const startTimer = useCallback(
    async (task: Task) => {
      return mutate(
        (list) => {
          let next = list
          for (const t of list) {
            if (t.id !== task.id && t.timer_started_at) {
              next = replaceTask(next, {
                ...t,
                timer_started_at: null,
                spent_seconds: t.spent_seconds + runningExtraSeconds(t),
              })
            }
          }
          return replaceTask(next, { ...task, timer_started_at: new Date().toISOString() })
        },
        async () => {
          const { error } = await supabase.rpc('start_timer', { task_id: task.id })
          return { error }
        },
        'Could not start timer',
      )
    },
    [mutate],
  )

  const pauseTimer = useCallback(
    async (task: Task) => {
      return mutate(
        (list) =>
          replaceTask(list, {
            ...task,
            timer_started_at: null,
            spent_seconds: task.spent_seconds + runningExtraSeconds(task),
          }),
        async () => {
          const { error } = await supabase.rpc('pause_timer', { task_id: task.id })
          return { error }
        },
        'Could not pause timer',
      )
    },
    [mutate],
  )

  const moveUnfinishedToTomorrow = useCallback(async () => {
    const unfinished = tasks.filter((t) => t.task_date === selectedDate && !t.is_done)
    if (unfinished.length === 0) return 0
    const tomorrow = addDays(selectedDate, 1)
    const ids = unfinished.map((t) => t.id)
    const ok = await mutate(
      (list) =>
        list.map((t) => (ids.includes(t.id) ? { ...t, task_date: tomorrow } : t)),
      async () => {
        const { error } = await supabase.from('tasks').update({ task_date: tomorrow }).in('id', ids)
        return { error }
      },
      'Could not move tasks',
    )
    if (ok) showToast({ message: `Moved ${unfinished.length} task${unfinished.length === 1 ? '' : 's'} to tomorrow`, type: 'success' })
    return ok ? unfinished.length : 0
  }, [tasks, selectedDate, mutate, showToast])

  const dayTasks = useMemo(
    () => sortTasks(tasks.filter((t) => t.task_date === selectedDate)),
    [tasks, selectedDate],
  )

  const dayStats = useMemo(() => {
    const stats = new Map<string, DayStat>()
    for (const day of week) stats.set(day.key, { done: 0, total: 0 })
    for (const t of tasks) {
      const s = stats.get(t.task_date)
      if (s) {
        s.total += 1
        if (t.is_done) s.done += 1
      }
    }
    return stats
  }, [tasks, week])

  return {
    tasks: dayTasks,
    allTasks: tasks,
    dayStats,
    loading,
    error,
    refresh: fetchWeek,
    addTask,
    updateTaskFields,
    toggleDone,
    deleteTask,
    startTimer,
    pauseTimer,
    moveUnfinishedToTomorrow,
  }
}
