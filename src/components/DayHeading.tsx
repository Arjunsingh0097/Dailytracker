import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon } from './Icon'
import { formatDayHeading } from '../lib/dates'

interface DayHeadingProps {
  dateKey: string
  today: string
  onPrev: () => void
  onNext: () => void
  onJumpToToday: () => void
  onCopyLink: () => void
}

export function DayHeading({ dateKey, today, onPrev, onNext, onJumpToToday, onCopyLink }: DayHeadingProps) {
  return (
    <div className="day-heading">
      <button type="button" className="icon-button" onClick={onPrev} aria-label="Previous day">
        <ChevronLeftIcon />
      </button>
      <h1 className="day-title">{formatDayHeading(dateKey)}</h1>
      <button type="button" className="icon-button" onClick={onNext} aria-label="Next day">
        <ChevronRightIcon />
      </button>
      <button
        type="button"
        className="pill-button ghost"
        onClick={onCopyLink}
        aria-label={`Copy link to ${formatDayHeading(dateKey)}`}
        title="Copy a link that opens this day"
      >
        <ExternalLinkIcon size={13} />
        Copy link
      </button>
      {dateKey !== today && (
        <button type="button" className="pill-button ghost" onClick={onJumpToToday}>
          Jump to today
        </button>
      )}
    </div>
  )
}
