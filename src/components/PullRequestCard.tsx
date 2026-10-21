import { ExternalLinkIcon, PrIcon, PrStateClosedIcon, PrStateMergedIcon, PrStateOpenIcon } from './Icon'
import { formatShortDate } from '../lib/format'
import type { PullRequest, PullRequestState } from '../types'

const ROLE_LABELS: Record<PullRequest['role'], string> = {
  author: 'Authored',
  reviewer: 'Reviewed',
  assignee: 'Assigned',
  review_requested: 'Review requested',
}

function StateIcon({ state }: { state: PullRequestState }) {
  if (state === 'merged') return <PrStateMergedIcon />
  if (state === 'closed') return <PrStateClosedIcon />
  return <PrStateOpenIcon />
}

function stateWord(state: PullRequestState): string {
  if (state === 'merged') return 'Merged'
  if (state === 'closed') return 'Closed'
  return 'Open'
}

interface PullRequestCardProps {
  pr: PullRequest
  onAdd: (pr: PullRequest) => Promise<void>
  added: boolean
  busy: boolean
}

export function PullRequestCard({ pr, onAdd, added, busy }: PullRequestCardProps) {
  return (
    <li className={`pr-card clay-card${pr.is_draft ? ' is-draft' : ''}`}>
      <div className="pr-card-top">
        <span className={`pr-state pr-state-${pr.state}`} title={stateWord(pr.state)}>
          <StateIcon state={pr.state} />
          <span>{stateWord(pr.state)}</span>
        </span>
        {pr.is_draft && <span className="pr-draft-chip">Draft</span>}
        <span className="pr-role-chip">{ROLE_LABELS[pr.role]}</span>
      </div>

      <a
        className="pr-title"
        href={pr.html_url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${pr.repo_full_name} pull request ${pr.number} on GitHub: ${pr.title}`}
      >
        {pr.title}
        <ExternalLinkIcon size={13} className="pr-title-ext" />
      </a>

      <p className="pr-meta">
        <PrIcon size={13} />
        <span className="pr-repo">
          {pr.repo_full_name} <span className="tabular">#{pr.number}</span>
        </span>
        {pr.author_login && <span className="pr-meta-sep">·</span>}
        {pr.author_login && <span>@{pr.author_login}</span>}
      </p>

      <div className="pr-dates">
        <span className="pr-date">Created {formatShortDate(pr.created_at_gh)}</span>
        {pr.state === 'merged' && pr.merged_at_gh && (
          <span className="pr-date">Merged {formatShortDate(pr.merged_at_gh)}</span>
        )}
        {pr.state === 'closed' && !pr.merged_at_gh && pr.closed_at_gh && (
          <span className="pr-date">Closed {formatShortDate(pr.closed_at_gh)}</span>
        )}
      </div>

      {pr.labels.length > 0 && (
        <ul className="pr-labels" aria-label="Labels">
          {pr.labels.map((label) => (
            <li key={label} className="label-pill">
              {label}
            </li>
          ))}
        </ul>
      )}

      <div className="pr-card-actions">
        <button
          type="button"
          className="pill-button"
          onClick={() => void onAdd(pr)}
          disabled={busy || added}
          aria-label={`Add ${pr.repo_full_name}#${pr.number} to today's tasks`}
        >
          <PrIcon />
          {added ? 'Added to today' : 'Add to today'}
        </button>
      </div>
    </li>
  )
}
