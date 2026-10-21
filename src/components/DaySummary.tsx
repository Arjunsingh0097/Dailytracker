import { formatDuration, formatMinutes } from '../lib/format'
import { useTimer } from '../hooks/useTimer'
import type { Task } from '../types'

interface DaySummaryProps {
  tasks: Task[]
}

export function DaySummary({ tasks }: DaySummaryProps) {
  const total = tasks.length
  const done = tasks.filter((t) => t.is_done).length
  const runningTask = tasks.find((t) => t.timer_started_at != null && !t.is_done) ?? null
  const { seconds: runningSeconds } = useTimer(runningTask?.timer_started_at ?? null, 0)
  const trackedSeconds = tasks.reduce(
    (sum, t) => sum + t.spent_seconds + (runningTask && t.id === runningTask.id ? runningSeconds : 0),
    0,
  )
  const estimatedMinutes = tasks.reduce((sum, t) => sum + (t.estimate_minutes ?? 0), 0)

  return (
    <div className="day-summary" aria-live="polite">
      <span className="summary-strong">
        {done} of {total} done
      </span>
      <span className="summary-sep" aria-hidden="true">
        ·
      </span>
      <span>
        Tracked <strong className="tabular">{formatDuration(trackedSeconds)}</strong>
      </span>
      {estimatedMinutes > 0 && (
        <>
          <span className="summary-sep" aria-hidden="true">
            ·
          </span>
          <span>
            Estimated <strong className="tabular">{formatMinutes(estimatedMinutes)}</strong>
          </span>
        </>
      )}
    </div>
  )
}
