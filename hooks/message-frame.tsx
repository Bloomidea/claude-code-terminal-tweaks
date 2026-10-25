import type { On } from 'claude-code'

import { isPersons } from './sent-times'
import type { Settings } from './settings'

export function registerMessageFrame(on: On, settings: Settings): void {
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !isPersons(e.props.origin.kind)) return next(e)

    const drawn = await next(e)
    const { Box } = $.ui.resolve(e)
    // With the time on, its row has taken the blank row the engine draws above
    // the message; without it, the message is pulled up over that row, so the
    // frame holds the message alone. The frame keeps the row's place outside.
    const pull = settings.messageTime ? 0 : -1

    return (
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle={settings.frameStyle}
        borderColor={settings.frameColor}
      >
        <Box flexDirection="column" marginTop={pull}>
          {drawn}
        </Box>
      </Box>
    )
  })
}
