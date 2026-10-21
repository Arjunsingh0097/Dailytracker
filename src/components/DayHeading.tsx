import { ChevronLeftIcon, ChevronRightIcon } from './Icon'
import { formatDayHeading } from '../lib/dates'

interface DayHeadingProps {
  dateKey: string
  today: string
  shared: boolean
  sharing: boolean
  onPrev: () => void
  onNext: () => void
  onJumpToToday: () => void
  onShare: () => void
  onCopyShare: () => void
  onRevokeShare: () => void
}

export function DayHeading({
  dateKey,
  today,
  shared,
  sharing,
  onPrev,
  onNext,
  onJumpToToday,
  onShare,
  onCopyShare,
  onRevokeShare,
}: DayHeadingProps) {
  return (
    <div className="day-heading">
      <button type="button" className="icon-button" onClick={onPrev} aria-label="Previous day">
        <ChevronLeftIcon />
      </button>
      <h1 className="day-title">{formatDayHeading(dateKey)}</h1>
      <button type="button" className="icon-button" onClick={onNext} aria-label="Next day">
        <ChevronRightIcon />
      </button>
      {shared ? (
        <>
          <button
            type="button"
            className="pill-button ghost"
            onClick={onCopyShare}
            aria-label={`Copy public link to ${formatDayHeading(dateKey)}`}
          >
            Copy share link
          </button>
          <button
            type="button"
            className="text-button"
            onClick={onRevokeShare}
            disabled={sharing}
            aria-label={`Stop sharing ${formatDayHeading(dateKey)}`}
          >
            Unshare
          </button>
        </>
      ) : (
        <button
          type="button"
          className="pill-button ghost"
          onClick={onShare}
          disabled={sharing}
          aria-label={`Share ${formatDayHeading(dateKey)} publicly`}
        >
          Share day
        </button>
      )}
      {dateKey !== today && (
        <button type="button" className="pill-button ghost" onClick={onJumpToToday}>
          Jump to today
        </button>
      )}
    </div>
  )
}
