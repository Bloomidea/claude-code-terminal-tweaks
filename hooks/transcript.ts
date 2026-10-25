// What one read of a transcript yields: when each prompt row was recorded, by
// its uuid, and when the person last sent one (0 when they never did).
export type Sent = { times: ReadonlyMap<string, number>; last: number }

export const NOTHING_SENT: Sent = { times: new Map(), last: 0 }

// Every prompt row carries an origin (the person's, a task notification's, a
// peer's); tool results and the engine's own rows do not. The same text keeps
// both reads of the transcript to those rows: a substring test here, and
// grep's -F in register.tsx.
const ORIGIN = '"origin":{"kind":"'
// How the transcript stamps the person's own messages: typed, queued, or a
// suggestion they accepted; `bridge` for one sent from the phone or the web.
const PERSONS = new Set(['human', 'bridge'])

type PromptRow = { uuid: string; timestamp: string; origin: { kind: string }; isMeta?: unknown }

const isPromptRow = (row: unknown): row is PromptRow => {
  if (typeof row !== 'object' || row === null) return false
  const { type, uuid, timestamp, origin } = row as Record<string, unknown>

  return (
    type === 'user' &&
    typeof uuid === 'string' &&
    typeof timestamp === 'string' &&
    typeof origin === 'object' &&
    origin !== null &&
    typeof (origin as Record<string, unknown>).kind === 'string'
  )
}

export function parseSent(text: string): Sent {
  const times = new Map<string, number>()
  let last = 0
  for (const line of text.split('\n')) {
    if (!line.includes(ORIGIN)) continue

    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!isPromptRow(row)) continue

    const at = Date.parse(row.timestamp)
    if (Number.isNaN(at)) continue

    times.set(row.uuid, at)
    if (PERSONS.has(row.origin.kind) && row.isMeta !== true) last = Math.max(last, at)
  }

  return { times, last }
}

// The folder name Claude Code keeps a project's transcripts under: every
// character but a letter or digit becomes a dash. A path long enough to be
// cut and hashed is found by the search in register.tsx's transcriptPath.
export const projectFolder = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, '-')
