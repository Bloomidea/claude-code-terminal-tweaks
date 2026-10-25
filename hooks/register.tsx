import type { Register } from 'claude-code'

import { startClock } from './clock'
import { registerLastMessage } from './last-message'
import { registerMessageFrame } from './message-frame'
import { registerMessageTime } from './message-time'
import { registerSentTimes, startSentTimes } from './sent-times'
import { readSettings } from './settings'

// Each tweak is registered only while it is on, so one switched off in
// /config leaves Claude Code drawing as it does without the plugin.
export const register: Register = (on, options) => {
  const settings = readSettings(options)

  // Hooks on one site run in the order registered, the first outermost: the
  // frame goes around the time.
  if (settings.messageFrame) registerMessageFrame(on, settings)
  if (settings.messageTime) registerMessageTime(on, settings)
  if (settings.lastMessage) registerLastMessage(on, settings)

  const needsTimes = settings.messageTime || settings.lastMessage
  const needsClock = settings.lastMessage || (settings.messageTime && !settings.todayDate)
  if (needsTimes) registerSentTimes(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (needsTimes) startSentTimes($)
    if (needsClock) await startClock($)

    return started
  })
}
