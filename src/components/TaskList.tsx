import { TaskItem } from './TaskItem'
import { MailIcon } from './Icon'
import type { Task } from '../types'

interface TaskListProps {
  tasks: Task[]
  loading: boolean
  onToggleDone: (task: Task) => Promise<boolean>
  onUpdate: (id: string, patch: { title?: string; estimate_minutes?: number | null; description?: string | null }) => Promise<boolean>
  onDelete: (task: Task) => Promise<boolean>
  onStartTimer: (task: Task) => Promise<boolean>
  onPauseTimer: (task: Task) => Promise<boolean>
}

export function TaskList({
  tasks,
  loading,
  onToggleDone,
  onUpdate,
  onDelete,
  onStartTimer,
  onPauseTimer,
}: TaskListProps) {
  if (loading) {
    return (
      <ul className="task-list" aria-busy="true" aria-label="Loading tasks">
        {[0, 1, 2].map((i) => (
          <li key={i} className="task-card clay-card skeleton-card" aria-hidden="true">
            <div className="skeleton-line skeleton-check" />
            <div className="skeleton-line skeleton-title" />
            <div className="skeleton-line skeleton-meta" />
          </li>
        ))}
      </ul>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="empty-state clay-card">
        <MailIcon className="empty-icon" />
        <p className="empty-title">Nothing planned for this day</p>
        <p className="empty-hint">Add your first task above — press Enter to save it. Keep it small: one line, one estimate, one timer.</p>
      </div>
    )
  }

  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          onToggleDone={onToggleDone}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onStartTimer={onStartTimer}
          onPauseTimer={onPauseTimer}
        />
      ))}
    </ul>
  )
}
