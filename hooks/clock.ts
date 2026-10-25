import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { dayKey } from './format'

const MINUTE_MS = 60_000

// Written on each new minute and each new day, so what reads them is drawn
// again: the last message line every minute, the stamps without today's date
// at midnight.
const minute = atom({ plugin: 'tweaks', key: 'minute' } as const, 0)
const today = atom({ plugin: 'tweaks', key: 'today' } as const, '')

async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, minute, () => Math.floor(now / MINUTE_MS))

  const day = dayKey(now)
  if ((await read($, today)) !== day) await update($, today, () => day)
}

// Started with the session: on the minute, then every minute.
export async function startClock($: EngineInterface): Promise<void> {
  await tick($)

  const now = await $.clock.now()
  $.clock.after(MINUTE_MS - (now % MINUTE_MS), () => {
    void tick($)
    $.clock.every(MINUTE_MS, () => void tick($))
  })
}
