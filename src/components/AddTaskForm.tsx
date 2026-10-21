import { useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { PlusIcon } from './Icon'

interface AddTaskFormProps {
  onAdd: (title: string, estimateMinutes: number | null) => Promise<boolean>
  titleInputRef?: RefObject<HTMLInputElement | null>
}

export function AddTaskForm({ onAdd, titleInputRef }: AddTaskFormProps) {
  const [title, setTitle] = useState('')
  const [estimate, setEstimate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      setError('Give the task a name first.')
      titleInputRef?.current?.focus()
      return
    }
    if (trimmed.length > 200) {
      setError('Task names can be at most 200 characters.')
      return
    }
    let estimateMinutes: number | null = null
    if (estimate.trim() !== '') {
      const value = Number(estimate)
      if (!Number.isInteger(value) || value < 1 || value > 999) {
        setError('Estimate must be a whole number of minutes between 1 and 999, or left blank.')
        return
      }
      estimateMinutes = value
    }
    setBusy(true)
    setError(null)
    const ok = await onAdd(trimmed, estimateMinutes)
    setBusy(false)
    if (ok) {
      setTitle('')
      setEstimate('')
      titleInputRef?.current?.focus()
    }
  }

  return (
    <form className="add-form clay-card" onSubmit={submit} aria-label="Add a task">
      <div className="add-row">
        <input
          ref={titleInputRef}
          className="clay-input add-title"
          type="text"
          placeholder="What needs doing? (Enter to add)"
          value={title}
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value)
            setError(null)
          }}
          aria-label="Task title"
        />
        <input
          className="clay-input add-estimate"
          type="number"
          inputMode="numeric"
          min={1}
          max={999}
          placeholder="min"
          value={estimate}
          onChange={(e) => {
            setEstimate(e.target.value)
            setError(null)
          }}
          aria-label="Estimate in minutes (optional)"
        />
        <button type="submit" className="primary-button add-button" disabled={busy} aria-label="Add task">
          <PlusIcon />
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
