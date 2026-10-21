/** mm:ss, or h:mm:ss when >= 1 hour. Always tabular-friendly. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** "just now", "3 min ago", "2 h ago", "5 d ago", or an absolute date. */
export function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return 'never'
  const diffMs = Date.now() - parsed
  if (diffMs < 60_000) return 'just now'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(parsed).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Short date like "Mar 3" (adds the year when it is not the current one). */
export function formatShortDate(iso: string | null): string {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  const sameYear = parsed.getFullYear() === new Date().getFullYear()
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** "23 days" / "5 hours" style span between now and a future time. */
export function formatTimeUntil(iso: string): string {
  const diffMs = Date.parse(iso) - Date.now()
  if (Number.isNaN(diffMs)) return ''
  if (diffMs <= 0) return 'now'
  const days = Math.floor(diffMs / 86_400_000)
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`
  const hours = Math.max(1, Math.floor(diffMs / 3_600_000))
  return `${hours} hour${hours === 1 ? '' : 's'}`
}
