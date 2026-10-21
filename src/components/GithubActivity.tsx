import { useState } from 'react'
import { ChevronDownIcon, PrIcon } from './Icon'
import { useDailyGithubActivity } from '../hooks/usePullRequests'
import { createTaskFromPr } from '../lib/tasks'
import { formatShortDate } from '../lib/format'
import { todayKey } from '../lib/dates'
import type { PullRequest } from '../types'
import { useToasts } from '../hooks/useToasts'

interface GithubActivityProps {
  userId: string
  dateKey: string
  /** True when at least one GitHub connection exists. */
  enabled: boolean
}

export function GithubActivity({ userId, dateKey, enabled }: GithubActivityProps) {
  const { items, loading } = useDailyGithubActivity(enabled ? userId : undefined, dateKey)
  const { showToast } = useToasts()
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addedUrls, setAddedUrls] = useState<Set<string>>(() => new Set())

  if (!enabled) return null

  const handleAdd = async (pr: PullRequest) => {
    setBusyId(pr.id)
    const result = await createTaskFromPr(userId, todayKey(), pr)
    setBusyId(null)
    if (result.ok) {
      setAddedUrls((prev) => new Set(prev).add(pr.html_url))
      showToast({ message: result.message, type: 'success' })
    } else {
      showToast({ message: result.message, type: 'info' })
    }
  }

  const dayLabel = dateKey === todayKey() ? 'today' : formatShortDate(`${dateKey}T12:00:00`)

  return (
    <section className="activity clay-card" aria-label="GitHub activity">
      <button
        type="button"
        className="activity-header"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <PrIcon size={16} />
        <span className="activity-title">GitHub activity</span>
        <span className="activity-count">{loading ? '…' : items.length}</span>
        <ChevronDownIcon size={16} className={`activity-chevron${open ? ' is-open' : ''}`} />
      </button>
      {open && (
        <div className="activity-body">
          {loading ? (
            <p className="gh-note" role="status">
              Loading activity for {dayLabel}…
            </p>
          ) : items.length === 0 ? (
            <p className="gh-note">
              No pull requests were created, merged or updated on {dayLabel}.
            </p>
          ) : (
            <ul className="activity-list">
              {items.map(({ pr, activities }) => (
                <li key={pr.id} className="activity-row">
                  <div className="activity-info">
                    <a
                      className="activity-link"
                      href={pr.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${pr.repo_full_name}#${pr.number} on GitHub`}
                    >
                      {pr.repo_full_name}#{pr.number} {pr.title}
                    </a>
                    <div className="activity-chips">
                      {activities.map((activity) => (
                        <span key={activity} className="activity-chip">
                          {activity}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="pill-button ghost activity-add"
                    onClick={() => void handleAdd(pr)}
                    disabled={busyId === pr.id || addedUrls.has(pr.html_url)}
                    aria-label={`Add ${pr.repo_full_name}#${pr.number} as a task`}
                  >
                    {addedUrls.has(pr.html_url) ? 'Added' : 'Add as task'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
