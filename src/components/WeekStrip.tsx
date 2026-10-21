import type { DayStat } from '../types'
import { WEEKDAY_LABELS, formatFullDate } from '../lib/dates'

interface WeekStripProps {
  days: { key: string; date: Date }[]
  selected: string
  today: string
  stats: Map<string, DayStat>
  onSelect: (key: string) => void
}

export function WeekStrip({ days, selected, today, stats, onSelect }: WeekStripProps) {
  return (
    <nav className="week-strip" aria-label="Week overview">
      {days.map((day, i) => {
        const stat = stats.get(day.key) ?? { done: 0, total: 0 }
        const pct = stat.total > 0 ? Math.round((stat.done / stat.total) * 100) : 0
        const isSelected = day.key === selected
        const label = `${formatFullDate(day.key)}, ${stat.total === 0 ? 'no tasks' : `${stat.done} of ${stat.total} done`}`
        return (
          <button
            key={day.key}
            type="button"
            className={`week-tile${isSelected ? ' is-selected' : ''}${day.key === today ? ' is-today' : ''}`}
            onClick={() => onSelect(day.key)}
            aria-current={isSelected ? 'date' : undefined}
            aria-label={label}
          >
            <span className="week-fill" style={{ height: `${pct}%` }} aria-hidden="true" />
            <span className="week-label" aria-hidden="true">
              {WEEKDAY_LABELS[i]}
            </span>
            <span className="week-num" aria-hidden="true">
              {day.date.getDate()}
            </span>
            {stat.total > 0 && (
              <span className="week-count" aria-hidden="true">
                {stat.done}/{stat.total}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
