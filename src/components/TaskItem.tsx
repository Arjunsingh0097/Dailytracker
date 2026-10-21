import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { CheckIcon, ExternalLinkIcon, PauseIcon, PencilIcon, PlayIcon, PrIcon, TrashIcon } from './Icon'
import { useTimer } from '../hooks/useTimer'
import { formatDuration, formatMinutes } from '../lib/format'
import type { Task } from '../types'

interface TaskItemProps {
  task: Task
  onToggleDone: (task: Task) => Promise<boolean>
  onUpdate: (id: string, patch: { title?: string; estimate_minutes?: number | null }) => Promise<boolean>
  onDelete: (task: Task) => Promise<boolean>
  onStartTimer: (task: Task) => Promise<boolean>
  onPauseTimer: (task: Task) => Promise<boolean>
}

export function TaskItem({ task, onToggleDone, onUpdate, onDelete, onStartTimer, onPauseTimer }: TaskItemProps) {
  const { seconds, running } = useTimer(task.timer_started_at, task.spent_seconds)
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingEstimate, setEditingEstimate] = useState(false)
  const [draftTitle, setDraftTitle] = useState(task.title)
  const [draftEstimate, setDraftEstimate] = useState(task.estimate_minutes?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const estimateInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus()
  }, [editingTitle])

  useEffect(() => {
    if (editingEstimate) estimateInputRef.current?.focus()
  }, [editingEstimate])

  useEffect(() => {
    if (!editingTitle) setDraftTitle(task.title)
  }, [task.title, editingTitle])

  useEffect(() => {
    if (!editingEstimate) setDraftEstimate(task.estimate_minutes?.toString() ?? '')
  }, [task.estimate_minutes, editingEstimate])

  const estimateSeconds = task.estimate_minutes != null ? task.estimate_minutes * 60 : null
  const overEstimate = estimateSeconds != null && seconds > estimateSeconds
  const progressPct =
    estimateSeconds != null && estimateSeconds > 0 ? Math.min(100, Math.round((seconds / estimateSeconds) * 100)) : null

  const saveTitle = async () => {
    const trimmed = draftTitle.trim()
    setEditingTitle(false)
    if (!trimmed || trimmed === task.title) {
      setDraftTitle(task.title)
      return
    }
    setBusy(true)
    await onUpdate(task.id, { title: trimmed.slice(0, 200) })
    setBusy(false)
  }

  const saveEstimate = async () => {
    setEditingEstimate(false)
    const raw = draftEstimate.trim()
    let value: number | null = null
    if (raw !== '') {
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 999) {
        setDraftEstimate(task.estimate_minutes?.toString() ?? '')
        return
      }
      value = parsed
    }
    if (value === task.estimate_minutes) return
    setBusy(true)
    await onUpdate(task.id, { estimate_minutes: value })
    setBusy(false)
  }

  const handleTimerToggle = async () => {
    setBusy(true)
    if (running) await onPauseTimer(task)
    else await onStartTimer(task)
    setBusy(false)
  }

  const titleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void saveTitle()
    } else if (event.key === 'Escape') {
      setDraftTitle(task.title)
      setEditingTitle(false)
    }
  }

  const estimateKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void saveEstimate()
    } else if (event.key === 'Escape') {
      setDraftEstimate(task.estimate_minutes?.toString() ?? '')
      setEditingEstimate(false)
    }
  }

  return (
    <li className={`task-card clay-card${running ? ' is-running' : ''}${task.is_done ? ' is-done' : ''}`}>
      <div className="task-main">
        <label className="task-check-wrap">
          <input
            type="checkbox"
            className="task-checkbox-input"
            checked={task.is_done}
            disabled={busy}
            onChange={() => void onToggleDone(task)}
            aria-label={task.is_done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
          />
          <span className="task-checkbox clay-check" aria-hidden="true">
            <CheckIcon size={14} />
          </span>
        </label>

        <div className="task-body">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="clay-input task-title-input"
              value={draftTitle}
              maxLength={200}
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={titleKeyDown}
              onBlur={() => void saveTitle()}
              aria-label="Edit task title"
            />
          ) : (
            <span className="task-title-row">
              <button
                type="button"
                className="task-title"
                onClick={() => setEditingTitle(true)}
                aria-label={`Edit title: ${task.title}`}
              >
                {task.title}
              </button>
              {task.github_pr_url && (
                <a
                  className="task-pr-link"
                  href={task.github_pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${task.github_pr_title ?? 'pull request'} on GitHub`}
                  title={task.github_pr_title ?? 'Open pull request on GitHub'}
                >
                  <PrIcon size={14} />
                  <ExternalLinkIcon size={11} />
                </a>
              )}
            </span>
          )}

          <div className="task-meta">
            {editingEstimate ? (
              <input
                ref={estimateInputRef}
                className="clay-input task-estimate-input"
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                placeholder="min"
                value={draftEstimate}
                onChange={(e) => setDraftEstimate(e.target.value)}
                onKeyDown={estimateKeyDown}
                onBlur={() => void saveEstimate()}
                aria-label="Edit estimate in minutes, blank for none"
              />
            ) : (
              <button
                type="button"
                className="estimate-chip"
                onClick={() => setEditingEstimate(true)}
                aria-label={task.estimate_minutes != null ? `Estimate ${task.estimate_minutes} minutes. Click to edit` : 'No estimate. Click to set one'}
              >
                {task.estimate_minutes != null ? `Estimate ${formatMinutes(task.estimate_minutes)}` : 'No estimate'}
                <PencilIcon size={12} className="chip-pencil" />
              </button>
            )}

            <span className="spent-chip tabular" aria-label={`Spent ${formatDuration(seconds)}`}>
              Spent {formatDuration(seconds)}
            </span>

            {overEstimate && <span className="over-chip">over estimate</span>}
          </div>

          {progressPct != null && (
            <div
              className={`estimate-progress${overEstimate ? ' is-over' : ''}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPct}
              aria-label="Time used against estimate"
            >
              <span className="estimate-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          )}

          {running && (
            <div className="task-timer tabular" role="timer" aria-live="polite" aria-atomic="true">
              <span className="pulse-dot" aria-hidden="true" />
              {formatDuration(seconds)}
            </div>
          )}
        </div>
      </div>

      <div className="task-actions">
        {!task.is_done && (
          <button
            type="button"
            className={`pill-button timer-button${running ? ' is-inverted' : ''}`}
            onClick={() => void handleTimerToggle()}
            disabled={busy}
            aria-label={running ? `Pause timer for ${task.title}` : `Start timer for ${task.title}`}
          >
            {running ? <PauseIcon /> : <PlayIcon />}
            {running ? 'Pause' : 'Start'}
          </button>
        )}
        <button
          type="button"
          className="icon-button subtle"
          onClick={() => setEditingTitle(true)}
          aria-label={`Edit ${task.title}`}
          disabled={busy}
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          className="icon-button subtle danger"
          onClick={() => void onDelete(task)}
          aria-label={`Delete ${task.title}`}
          disabled={busy}
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  )
}
