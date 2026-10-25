import type { Settings } from './settings'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const pad = (n: number): string => String(n).padStart(2, '0')

// Today's date in the machine's time zone, YYYY-MM-DD.
export function dayKey(ms: number): string {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatDate(ms: number, format: Settings['dateFormat']): string {
  const d = new Date(ms)
  const day = pad(d.getDate())
  const month = pad(d.getMonth() + 1)
  const weekday = WEEKDAYS[d.getDay()] ?? ''

  switch (format) {
    case 'Sun 25/10':
      return `${weekday} ${day}/${month}`
    case '25/10':
      return `${day}/${month}`
    case 'Sun 10/25':
      return `${weekday} ${month}/${day}`
    case '10/25':
      return `${month}/${day}`
    case '2026-10-25':
      return dayKey(ms)
  }
}

export function formatTime(ms: number, clock: Settings['clock']): string {
  const d = new Date(ms)
  const minutes = pad(d.getMinutes())
  if (clock === '24h') return `${pad(d.getHours())}:${minutes}`

  const hours = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12

  return `${hours}:${minutes} ${d.getHours() < 12 ? 'am' : 'pm'}`
}

// "Sun 25/10 · 14:05", or "14:05" for a message of today when the date is
// left out of today's messages.
export function stamp(ms: number, today: string, settings: Settings): string {
  const time = formatTime(ms, settings.clock)

  return !settings.todayDate && dayKey(ms) === today ? time : `${formatDate(ms, settings.dateFormat)} · ${time}`
}

// "14:05 · 2h ago" for today, "Fri 23/10 14:05 · 2d ago" for another day.
export function lastMessageLine(ms: number, now: number, settings: Settings): string {
  const time = formatTime(ms, settings.clock)
  const when = dayKey(ms) === dayKey(now) ? time : `${formatDate(ms, settings.dateFormat)} ${time}`

  return `last message ${when} · ${ago(now - ms)}`
}

export function ago(elapsed: number): string {
  if (elapsed < MINUTE_MS) return 'just now'
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`

  return `${Math.floor(elapsed / DAY_MS)}d ago`
}
