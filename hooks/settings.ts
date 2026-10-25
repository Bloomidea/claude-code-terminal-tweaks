import type { PluginOptions } from 'claude-code'

export const DATE_FORMATS = ['Sun 25/10', '25/10', 'Sun 10/25', '10/25', '2026-10-25'] as const
export const CLOCKS = ['24h', '12h'] as const
export const FRAME_STYLES = ['round', 'single', 'bold', 'double', 'dashed', 'quote'] as const

export type DateFormat = (typeof DATE_FORMATS)[number]
export type Clock = (typeof CLOCKS)[number]
export type FrameStyle = (typeof FRAME_STYLES)[number]

// The plugin's userConfig, typed; a value outside a field's options reads as
// the field's default, as the config menu itself treats it.
export type Settings = {
  messageTime: boolean
  dateFormat: DateFormat
  todayDate: boolean
  clock: Clock
  messageFrame: boolean
  frameStyle: FrameStyle
  frameColor: string
  lastMessage: boolean
}

export const DEFAULTS: Settings = {
  messageTime: true,
  dateFormat: 'Sun 25/10',
  todayDate: true,
  clock: '24h',
  messageFrame: true,
  frameStyle: 'round',
  frameColor: 'suggestion',
  lastMessage: true,
}

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.find(item => item === value) ?? fallback

export function readSettings(options: PluginOptions): Settings {
  return {
    messageTime: flag(options.messageTime, DEFAULTS.messageTime),
    dateFormat: oneOf(options.dateFormat, DATE_FORMATS, DEFAULTS.dateFormat),
    todayDate: flag(options.todayDate, DEFAULTS.todayDate),
    clock: oneOf(options.clock, CLOCKS, DEFAULTS.clock),
    messageFrame: flag(options.messageFrame, DEFAULTS.messageFrame),
    frameStyle: oneOf(options.frameStyle, FRAME_STYLES, DEFAULTS.frameStyle),
    frameColor: typeof options.frameColor === 'string' && options.frameColor !== '' ? options.frameColor : DEFAULTS.frameColor,
    lastMessage: flag(options.lastMessage, DEFAULTS.lastMessage),
  }
}
