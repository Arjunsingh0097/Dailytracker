import { ChevronLeftIcon, ChevronRightIcon } from './Icon'
import { formatDayHeading } from '../lib/dates'

interface DayHeadingProps {
  dateKey: string
  today: string
  onPrev: () => void
  onNext: () => void
  onJumpToToday: () => void
}

export function DayHeading({ dateKey, today, onPrev, onNext, onJumpToToday }: DayHeadingProps) {
  return (
    <div className="day-heading">
      <button type="button" className="icon-button" onClick={onPrev} aria-label="Previous day">
        <ChevronLeftIcon />
      </button>
      <h1 className="day-title">{formatDayHeading(dateKey)}</h1>
      <button type="button" className="icon-button" onClick={onNext} aria-label="Next day">
        <ChevronRightIcon />
      </button>
      {dateKey !== today && (
        <button type="button" className="pill-button ghost" onClick={onJumpToToday}>
          Jump to today
        </button>
      )}
    </div>
  )
}
