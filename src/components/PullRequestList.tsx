import { useState } from 'react'
import { PullRequestCard } from './PullRequestCard'
import { MailIcon, PrIcon, SyncIcon } from './Icon'
import { PR_ROLE_TABS, usePullRequests, type PrFilters } from '../hooks/usePullRequests'
import type { GithubApi } from '../hooks/useGithub'
import { createTaskFromPr } from '../lib/tasks'
import { formatRelative } from '../lib/format'
import { todayKey } from '../lib/dates'
import type { PullRequest, PullRequestState } from '../types'
import { useToasts } from '../hooks/useToasts'

const STATE_OPTIONS: Array<{ value: PullRequestState; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'merged', label: 'Merged' },
  { value: 'closed', label: 'Closed' },
]

const SORT_OPTIONS: Array<{ value: PrFilters['sort']; label: string }> = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Recently created' },
  { value: 'merged', label: 'Recently merged' },
]

interface PullRequestListProps {
  userId: string
  github: GithubApi
  onOpenTasks: () => void
}

export function PullRequestList({ userId, github, onOpenTasks }: PullRequestListProps) {
  const {
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
  } = usePullRequests(userId)
  const { showToast } = useToasts()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addedUrls, setAddedUrls] = useState<Set<string>>(() => new Set())

  const connected = github.connections.length > 0
  const anySynced = github.connections.some((c) => c.last_synced_at !== null)

  const handleAdd = async (pr: PullRequest) => {
    setBusyId(pr.id)
    const result = await createTaskFromPr(userId, todayKey(), pr)
    setBusyId(null)
    if (result.ok) {
      setAddedUrls((prev) => new Set(prev).add(pr.html_url))
      showToast({
        message: result.message,
        type: 'success',
        action: { label: 'View tasks', onClick: onOpenTasks },
      })
    } else {
      showToast({ message: result.message, type: 'info' })
    }
  }

  if (!connected) {
    return (
      <div className="empty-state clay-card">
        <PrIcon className="empty-icon" size={30} />
        <p className="empty-title">Connect GitHub to see pull requests</p>
        <p className="empty-hint">
          Add a read-only fine-grained token in Settings (the gear icon). Your pull requests will
          appear here, grouped by authored, review requested, reviewed and assigned.
        </p>
      </div>
    )
  }

  const summaryText = summary
    ? [
        `${summary.createdWeek} created this week`,
        `${summary.createdMonth} this month`,
        `${summary.merged} merged`,
        ...(summary.avgMergeLabel ? [`avg merge ${summary.avgMergeLabel}`] : []),
      ].join(' · ')
    : null

  const toggleState = (state: PullRequestState) => {
    const has = filters.states.includes(state)
    setFilters({
      states: has ? filters.states.filter((s) => s !== state) : [...filters.states, state],
    })
  }

  const toggleRepo = (repo: string) => {
    const has = filters.repos.includes(repo)
    setFilters({
      repos: has ? filters.repos.filter((r) => r !== repo) : [...filters.repos, repo],
    })
  }

  return (
    <div className="pr-page">
      <div className="pr-toolbar">
        <div className="pr-tabs" role="tablist" aria-label="Pull request roles">
          {PR_ROLE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={filters.role === tab.value}
              className={`tab-chip${filters.role === tab.value ? ' is-selected' : ''}`}
              onClick={() => setFilters({ role: tab.value })}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="pr-sync-row">
          <span className="gh-note">Last synced {formatRelative(github.lastSyncedAt)}</span>
          <button
            type="button"
            className="pill-button"
            onClick={() => void github.sync('incremental')}
            disabled={github.syncing}
            aria-label="Sync pull requests now"
          >
            <SyncIcon />
            Sync now
          </button>
        </div>

        {github.syncing && (
          <p className="gh-sync-status" role="status" aria-live="polite">
            <span className="pulse-dot" aria-hidden="true" />
            {github.syncProgress ?? 'Syncing…'}
          </p>
        )}
        {github.error && (
          <p className="auth-error" role="alert">
            {github.error}
          </p>
        )}
        {!github.syncing && !anySynced && (
          <p className="gh-note">
            No sync has run yet. Use Sync now to fetch your pull request history — the first full
            sync can take a minute.
          </p>
        )}
      </div>

      <div className="pr-filters clay-card" aria-label="Filter pull requests">
        <div className="filter-row">
          <div className="filter-group" role="group" aria-label="State">
            <span className="filter-label">State</span>
            {STATE_OPTIONS.map((option) => (
              <label key={option.value} className="check-chip">
                <input
                  type="checkbox"
                  checked={filters.states.includes(option.value)}
                  onChange={() => toggleState(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <span className="filter-label">Repository</span>
            {repos.length === 0 ? (
              <span className="gh-note">No repositories yet</span>
            ) : (
              <details className="repo-select">
                <summary className="pill-button ghost">
                  {filters.repos.length === 0
                    ? 'All repositories'
                    : `${filters.repos.length} selected`}
                </summary>
                <div className="repo-menu">
                  {repos.map((repo) => (
                    <label key={repo} className="repo-option">
                      <input
                        type="checkbox"
                        checked={filters.repos.includes(repo)}
                        onChange={() => toggleRepo(repo)}
                      />
                      <span>{repo}</span>
                    </label>
                  ))}
                  {filters.repos.length > 0 && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setFilters({ repos: [] })}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-group">
            <label className="filter-label" htmlFor="pr-from">
              Created from
            </label>
            <input
              id="pr-from"
              type="date"
              className="clay-input filter-date"
              value={filters.from ?? ''}
              onChange={(e) => setFilters({ from: e.target.value === '' ? null : e.target.value })}
            />
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor="pr-to">
              Created to
            </label>
            <input
              id="pr-to"
              type="date"
              className="clay-input filter-date"
              value={filters.to ?? ''}
              onChange={(e) => setFilters({ to: e.target.value === '' ? null : e.target.value })}
            />
          </div>
          <div className="filter-group filter-grow">
            <label className="filter-label" htmlFor="pr-search">
              Search titles
            </label>
            <input
              id="pr-search"
              type="search"
              className="clay-input"
              placeholder="e.g. login form"
              value={filters.query}
              onChange={(e) => setFilters({ query: e.target.value })}
            />
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor="pr-sort">
              Sort by
            </label>
            <select
              id="pr-sort"
              className="clay-input filter-select"
              value={filters.sort}
              onChange={(e) => setFilters({ sort: e.target.value as PrFilters['sort'] })}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {(filters.states.length > 0 ||
          filters.repos.length > 0 ||
          filters.from ||
          filters.to ||
          filters.query !== '') && (
          <button
            type="button"
            className="text-button"
            onClick={() => setFilters({ states: [], repos: [], from: null, to: null, query: '' })}
          >
            Clear filters
          </button>
        )}
      </div>

      {summaryText && <p className="pr-summary">{summaryText}</p>}

      {error && (
        <div className="load-error clay-card" role="alert">
          <p>{error}</p>
          <button type="button" className="pill-button ghost" onClick={refresh}>
            Try again
          </button>
        </div>
      )}

      {loading ? (
        <ul className="task-list" aria-busy="true" aria-label="Loading pull requests">
          {[0, 1, 2].map((i) => (
            <li key={i} className="task-card clay-card skeleton-card" aria-hidden="true">
              <div className="skeleton-line skeleton-meta" />
              <div className="skeleton-line skeleton-title" />
              <div className="skeleton-line skeleton-meta" />
            </li>
          ))}
        </ul>
      ) : prs.length === 0 ? (
        <div className="empty-state clay-card">
          <MailIcon className="empty-icon" />
          <p className="empty-title">No pull requests found</p>
          <p className="empty-hint">
            Check that your token includes the right repositories. Pull requests appear after a
            sync — use Sync now, or wait for the next automatic sync.
          </p>
        </div>
      ) : (
        <>
          <ul className="pr-list">
            {prs.map((pr) => (
              <PullRequestCard
                key={pr.id}
                pr={pr}
                onAdd={handleAdd}
                added={addedUrls.has(pr.html_url)}
                busy={busyId === pr.id}
              />
            ))}
          </ul>
          {hasMore && (
            <div className="pr-load-more">
              <button
                type="button"
                className="pill-button"
                onClick={loadMore}
                disabled={loadingMore}
                aria-label="Load more pull requests"
              >
                {loadingMore ? 'Loading…' : `Load more (${total - prs.length} remaining)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
