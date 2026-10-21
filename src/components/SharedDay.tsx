import { useEffect, useState } from 'react'
import { ExternalLinkIcon, PrIcon } from './Icon'
import { fetchSharedDay, type SharedDayData } from '../lib/shares'
import { formatDayHeading } from '../lib/dates'
import { formatDuration, formatMinutes } from '../lib/format'

function runningSeconds(spent: number, startedAt: string | null): number {
  if (!startedAt) return spent
  const started = Date.parse(startedAt)
  if (Number.isNaN(started)) return spent
  return spent + Math.max(0, Math.floor((Date.now() - started) / 1000))
}

/**
 * Public read-only view of a shared day (?share=<uuid>).
 * Reachable without signing in — the share token is the capability.
 */
export function SharedDay({ token }: { token: string }) {
  const [shared, setShared] = useState<SharedDayData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void fetchSharedDay(token).then((data) => {
      if (cancelled) return
      setShared(data)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [token])

  const notFound = !loading && shared === null
  const empty = !loading && shared !== null && shared.tasks.length === 0

  return (
    <div className="auth-shell share-shell">
      <div className="app-brand share-brand">
        <span className="app-logo" aria-hidden="true" />
        <span className="app-name">Daily Task Tracker</span>
      </div>

      {loading ? (
        <div className="auth-card clay-card skeleton-card" aria-label="Loading shared day" aria-busy="true">
          <div className="skeleton-line skeleton-title" />
          <div className="skeleton-line skeleton-meta" />
        </div>
      ) : notFound ? (
        <div className="auth-card clay-card">
          <h1 className="auth-title">Nothing to show</h1>
          <p className="auth-copy">This share link is invalid or has been turned off.</p>
        </div>
      ) : empty ? (
        <div className="auth-card clay-card">
          <h1 className="auth-title">{shared ? formatDayHeading(shared.task_date) : ''}</h1>
          <p className="auth-copy">This day has no tasks to share.</p>
        </div>
      ) : (
        <div className="share-day">
          <h1 className="day-title share-day-title">{formatDayHeading(shared!.task_date)}</h1>
          <p className="gh-note share-day-note">Shared publicly · read-only view</p>
          <ul className="task-list">
            {shared!.tasks.map((row, index) => {
              const seconds = runningSeconds(row.spent_seconds, row.timer_started_at)
              const estimateSeconds = row.estimate_minutes != null ? row.estimate_minutes * 60 : null
              const over = estimateSeconds != null && seconds > estimateSeconds
              return (
                <li key={index} className={`task-card clay-card${row.is_done ? ' is-done' : ''}`}>
                  <span className="task-check-wrap" aria-hidden="true">
                    <span className={`task-checkbox clay-check${row.is_done ? ' is-checked' : ''}`}>
                      {row.is_done ? '✓' : ''}
                    </span>
                  </span>
                  <div className="task-body">
                    <span className="task-title share-title-row">
                      {row.title}
                      {row.is_done && <span className="done-chip">Done</span>}
                    </span>
                    {row.description && <p className="task-desc share-desc">{row.description}</p>}
                    <div className="task-meta">
                      {row.estimate_minutes != null && (
                        <span className="estimate-chip">Estimate {formatMinutes(row.estimate_minutes)}</span>
                      )}
                      <span className="spent-chip tabular">Spent {formatDuration(seconds)}</span>
                      {row.timer_started_at && <span className="over-chip">running</span>}
                      {over && <span className="over-chip">over estimate</span>}
                      {row.github_pr_url && (
                        <a
                          className="task-pr-link"
                          href={row.github_pr_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open pull request on GitHub"
                        >
                          <PrIcon size={14} />
                          <ExternalLinkIcon size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <p className="footer-note">Daily Task Tracker · anyone with this link can view this day</p>
    </div>
  )
}
