import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import { dayKey, stamp } from './format'
import { isPersons, sentAt } from './sent-times'
import type { Settings } from './settings'

// Written by clock.ts when the day changes.
const today = atom({ plugin: 'tweaks', key: 'today' } as const, '')

export function registerMessageTime(on: On, settings: Settings): void {
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !isPersons(e.props.origin.kind)) return next(e)

    const at = await sentAt($, e)
    const drawn = await next(e)
    // Read only when today's messages leave the date out, so that is the only
    // case where every row is drawn again when the day changes.
    const day = settings.todayDate ? '' : (await read($, today)) || dayKey(await $.clock.now())
    const { Box, Text } = $.ui.resolve(e)

    // The time sits on the blank row the engine draws above each message, by
    // pulling the message up under it. Were that row gone, the message would
    // cover the time, never the time the message.
    return (
      <Box flexDirection="column">
        <Box justifyContent="flex-end" marginRight={1}>
          <Text dimColor>{at === undefined ? ' ' : stamp(at, day, settings)}</Text>
        </Box>
        <Box flexDirection="column" marginTop={-1}>
          {drawn}
        </Box>
      </Box>
    )
  })
}
