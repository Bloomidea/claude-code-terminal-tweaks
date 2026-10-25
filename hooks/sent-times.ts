import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, RenderInput } from 'claude-code'

import { NOTHING_SENT, readSent, transcriptPath } from './transcript'
import type { Sent } from './transcript'

// When each of the person's messages was sent, and the last of them: what
// the time on a message and the last message line both draw from. The
// transcript is the one source, so a live session and a resumed one show the
// same time.
const sent = atom({ plugin: 'terminal-tweaks', key: 'sent' } as const, 0)
const lastSent = atom({ plugin: 'terminal-tweaks', key: 'lastSent' } as const, 0)

// The id the engine draws a prompt under in the moment before it is recorded;
// the next row drawn under an id of its own is that prompt.
const PLACEHOLDER = 'placeholder'
const PLACEHOLDER_MS = 5_000
// Rows drawn together (a resumed session draws all of them) share one read.
const GATHER_MS = 300
// A row the transcript does not hold yet is looked for again after these.
const RETRIES_MS = [1_000, 5_000]

// The person's own prompts: typed here, or sent from the phone or the web.
export const isPersons = (kind: string): boolean => kind === 'composer' || kind === 'bridge'

// Bookkeeping for the reads, never stored: lost on a reload, after which the
// rows still missing a time ask again as they are drawn.
const waiting = new Set<string>()
const misses = new Map<string, number>()
// What a new prompt shows until the transcript says when it was recorded.
const provisional = new Map<string, number>()
let placeholderAt: number | undefined
let isScheduled = false
let found: { sessionId: string; path: string } | undefined

async function load($: EngineInterface): Promise<Sent> {
  try {
    const sessionId = await $.session.id()
    if (found?.sessionId !== sessionId) {
      const path = await transcriptPath($, sessionId)
      // A session that has recorded nothing yet has no transcript.
      if (path === undefined) return NOTHING_SENT
      found = { sessionId, path }
    }

    return await readSent($, found.path)
  } catch {
    return NOTHING_SENT
  }
}

async function refresh($: EngineInterface): Promise<void> {
  const ids = [...waiting]
  waiting.clear()
  const transcript = await load($)

  for (const id of ids) {
    const at = transcript.times.get(id)
    if (at !== undefined) {
      misses.delete(id)
      await update($, memberOf(sent, { requestId: id }), () => at)
      provisional.delete(id)
      continue
    }

    const missed = (misses.get(id) ?? 0) + 1
    misses.set(id, missed)
    const retry = RETRIES_MS[missed - 1]
    if (retry === undefined) {
      provisional.delete(id)
    } else {
      waiting.add(id)
      schedule($, retry)
    }
  }

  const { last } = transcript
  if (last > 0 && (await read($, lastSent)) !== last) await update($, lastSent, () => last)
}

function schedule($: EngineInterface, ms: number): void {
  if (isScheduled) return

  isScheduled = true
  $.clock.after(ms, () => {
    isScheduled = false
    void refresh($)
  })
}

function ask($: EngineInterface, id: string): void {
  // Given up on: the row is in no transcript this session can find.
  if ((misses.get(id) ?? 0) > RETRIES_MS.length) return

  waiting.add(id)
  schedule($, GATHER_MS)
}

// When the row drawn was sent, or undefined while that is being looked up;
// the drawing is redrawn once the transcript has said.
export async function sentAt($: EngineInterface, e: Pick<RenderInput, 'requestId'>): Promise<number | undefined> {
  const now = await $.clock.now()
  if (e.requestId === PLACEHOLDER) {
    placeholderAt = now

    return now
  }

  const at = await read($, memberOf(sent, e))
  if (at > 0) return at

  if (placeholderAt !== undefined && now - placeholderAt < PLACEHOLDER_MS && !provisional.has(e.requestId)) {
    provisional.set(e.requestId, placeholderAt)
  }
  placeholderAt = undefined
  ask($, e.requestId)

  return provisional.get(e.requestId)
}

// Started with the session: a resumed session's last message is read before
// any of its rows asks.
export function startSentTimes($: EngineInterface): void {
  schedule($, GATHER_MS)
}

export function registerSentTimes(on: On): void {
  on('session.end', async ($, e, next) => {
    // /clear starts an empty conversation; /resume brings another one in,
    // whose transcript is read once it is in place.
    if (e.reason === 'clear' || e.reason === 'resume') {
      found = undefined
      await update($, lastSent, () => 0)
      if (e.reason === 'resume') $.clock.after(1_000, () => startSentTimes($))
    }

    return next(e)
  })
}
