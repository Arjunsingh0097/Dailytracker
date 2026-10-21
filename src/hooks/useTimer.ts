import { useEffect, useState } from 'react'

/** Live elapsed seconds for a task, computed from timer_started_at (survives reloads). */
export function useTimer(timerStartedAt: string | null, spentSeconds: number): {
  seconds: number
  running: boolean
} {
  const running = timerStartedAt != null
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running, timerStartedAt])

  const startedMs = timerStartedAt ? Date.parse(timerStartedAt) : null
  const elapsed =
    running && startedMs != null && !Number.isNaN(startedMs)
      ? Math.max(0, Math.floor((now - startedMs) / 1000))
      : 0

  return { seconds: spentSeconds + elapsed, running }
}
