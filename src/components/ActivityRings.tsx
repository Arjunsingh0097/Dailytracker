import { useEffect, useState } from 'react'
import type { Task } from '../types'

/** Large ring radii, outside → inside (Apple-Watch style). */
const RADII = [108, 91, 74, 57, 40]
/** Ring colour per ring, outside → inside (Apple-Watch style palette). */
const COLORS = ['var(--ring-1)', 'var(--ring-2)', 'var(--ring-3)', 'var(--ring-4)', 'var(--ring-5)']
const TRACK_OPACITY = 0.13
const STROKE = 14
const MAX_RINGS = 5
const CENTER = 120

function progressOf(task: Task, nowMs: number): number {
  if (task.is_done) return 1
  const estimateSeconds = task.estimate_minutes != null ? task.estimate_minutes * 60 : null
  if (estimateSeconds == null || estimateSeconds <= 0) return 0
  let spent = task.spent_seconds
  if (task.timer_started_at) {
    const started = Date.parse(task.timer_started_at)
    if (!Number.isNaN(started)) spent += Math.max(0, (nowMs - started) / 1000)
  }
  return Math.min(1, spent / estimateSeconds)
}

function statusOf(task: Task, progress: number): string {
  if (task.is_done) return 'Closed'
  if (task.timer_started_at) return 'Running'
  if (task.estimate_minutes == null) return 'No estimate'
  return `${Math.round(progress * 100)}%`
}

function MiniRing({ progress, color }: { progress: number; color: string }) {
  const r = 9
  const circumference = 2 * Math.PI * r
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" className="mini-ring" aria-hidden="true">
      <g transform="rotate(-90 12 12)">
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke={color}
          strokeOpacity={TRACK_OPACITY}
          strokeWidth="4"
        />
        {progress > 0 && (
          <circle
            className="ring-arc"
            cx="12"
            cy="12"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
          />
        )}
      </g>
    </svg>
  )
}

interface ActivityRingsProps {
  tasks: Task[]
}

export function ActivityRings({ tasks }: ActivityRingsProps) {
  const [now, setNow] = useState(() => Date.now())
  const anyRunning = tasks.some((t) => t.timer_started_at && !t.is_done)

  // Tick once a second while a timer runs so ring progress stays live.
  useEffect(() => {
    if (!anyRunning) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [anyRunning])

  const total = tasks.length
  const done = tasks.filter((t) => t.is_done).length
  const shown = tasks.slice(0, MAX_RINGS)
  const ringsShown = shown.length
  const showClosedLabel = ringsShown > 0 && ringsShown <= 4

  return (
    <section className="rings-card clay-card" aria-label="Activity rings">
      <h2 className="rings-heading">Activity rings</h2>

      <svg
        viewBox="0 0 240 240"
        className="rings-svg"
        role="img"
        aria-label={`${done} of ${total} task rings closed`}
      >
        <g transform="rotate(-90 120 120)">
          {shown.map((task, index) => {
            const radius = RADII[index]
            const circumference = 2 * Math.PI * radius
            const progress = progressOf(task, now)
            const color = COLORS[index]
            return (
              <g key={task.id}>
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={radius}
                  fill="none"
                  stroke={color}
                  strokeOpacity={TRACK_OPACITY}
                  strokeWidth={STROKE}
                />
                {progress > 0 && (
                  <circle
                    className="ring-arc"
                    cx={CENTER}
                    cy={CENTER}
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - progress)}
                  />
                )}
              </g>
            )
          })}
        </g>
        <text
          x={CENTER}
          y={showClosedLabel ? 112 : CENTER}
          textAnchor="middle"
          dominantBaseline="central"
          className="rings-count"
        >
          {done}/{total}
        </text>
        {showClosedLabel && (
          <text
            x={CENTER}
            y={144}
            textAnchor="middle"
            dominantBaseline="central"
            className="rings-sub"
          >
            closed
          </text>
        )}
      </svg>

      {total === 0 && <p className="gh-note rings-empty">Add tasks to fill your rings.</p>}
      {total > MAX_RINGS && (
        <p className="gh-note rings-more">
          Showing the first {MAX_RINGS} of {total} tasks — every task is listed below.
        </p>
      )}

      <ul className="ring-task-list">
        {tasks.map((task, index) => {
          const progress = progressOf(task, now)
          return (
            <li key={task.id} className="ring-task-row">
              <MiniRing progress={progress} color={COLORS[index % COLORS.length]} />
              <span className="ring-task-title" title={task.title}>
                {task.title}
              </span>
              <span className="ring-task-status tabular">{statusOf(task, progress)}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
