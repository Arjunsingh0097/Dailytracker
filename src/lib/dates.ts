/** Local calendar-date helpers. task_date is a plain local date string (YYYY-MM-DD). */

export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(key: string, days: number): string {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

export function todayKey(): string {
  return toDateKey(new Date())
}

/** Monday-based week containing `key`, as 7 local dates. */
export function weekOf(key: string): { key: string; date: Date }[] {
  const date = parseDateKey(key)
  const mondayOffset = (date.getDay() + 6) % 7
  const monday = addDays(key, -mondayOffset)
  return Array.from({ length: 7 }, (_, i) => {
    const k = addDays(monday, i)
    return { key: k, date: parseDateKey(k) }
  })
}

export function formatDayHeading(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export function formatFullDate(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
