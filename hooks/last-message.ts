import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import { lastMessageLine } from './format'
import type { Settings } from './settings'

// Written by sent-times.ts and clock.ts; the state library reads an atom only
// in the file that names it.
const lastSent = atom({ plugin: 'terminal-tweaks', key: 'lastSent' } as const, 0)
const minute = atom({ plugin: 'terminal-tweaks', key: 'minute' } as const, 0)

export function registerLastMessage(on: On, settings: Settings): void {
  // The dim hint line under the prompt: the line goes at its end, dim as the
  // rest, beside the engine's own hints.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)

    const last = await read($, lastSent)
    // Read so the line is drawn again each minute.
    await read($, minute)
    if (last === 0) return next(e)

    const line = lastMessageLine(last, await $.clock.now(), settings)
    const tail = e.props.tail === undefined ? line : `${e.props.tail} · ${line}`

    return next({ ...e, props: { ...e.props, tail } })
  })
}
