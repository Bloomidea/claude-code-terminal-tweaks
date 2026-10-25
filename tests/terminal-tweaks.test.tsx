import type { On, PromptOrigin, RenderPropsOf, RenderSurface } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { ago, formatTime, lastMessageLine, stamp } from '../hooks/format'
import { DEFAULTS } from '../hooks/settings'
import { parseSent, projectFolder } from '../hooks/transcript'

const PLUGIN = 'terminal-tweaks'
const SESSION = '0d4c3e9a-5b1f-4e2a-9c7d-2f6e8a1b3c5d'
const HOME = '/Users/ana'
const CWD = '/Users/ana/Dev/shop'
const TRANSCRIPT = `${HOME}/.claude/projects/-Users-ana-Dev-shop/${SESSION}.jsonl`

// Local times, so the tests read the same in any time zone. 25/10/2026 is a
// Sunday.
const at = (hours: number, minutes: number, day = 25): number => new Date(2026, 9, day, hours, minutes).getTime()

const prompt = (uuid: string, ms: number, kind = 'human'): string =>
  JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: 'user',
    message: { role: 'user', content: 'hi' },
    uuid,
    timestamp: new Date(ms).toISOString(),
    origin: { kind },
  })

const toolResult = (uuid: string, ms: number): string =>
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    uuid,
    timestamp: new Date(ms).toISOString(),
  })

const LINES = [
  prompt('u1', at(10, 29)),
  toolResult('r1', at(10, 30)),
  prompt('n1', at(10, 40), 'task-notification'),
  prompt('u2', at(12, 5)),
  '{"type":"user","origin":{"kind":"human"',
  '',
]

const COMPOSER: PromptOrigin = { kind: 'composer' }

const userMessage = (origin: PromptOrigin = COMPOSER): RenderPropsOf['UserMessage'] => ({
  text: 'hi',
  origin,
  isExpanded: false,
})

// The tails the engine was handed for the hint line under the prompt.
const tails: (string | undefined)[] = []

// What a test changes in the world: the transcript's size on disk, and a
// count of its reads.
type Shape = { size?: number; onRead?: () => void }

// The world beneath the plugin: a session in CWD whose transcript holds
// `lines`, Claude Code's own drawing of a row, and a clock at `now`.
function world(on: On, lines: readonly string[], now: number, shape: Shape = {}): MockClock {
  tails.length = 0
  const files: Record<string, string> = { [TRANSCRIPT]: lines.join('\n') }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: CWD }))
  on('session.cwd', () => ({ value: CWD }))
  mock.env(on, { HOME })
  on('fs.exists', ($, e) => ({ value: e.path in files }))
  on('fs.stat', ($, e) => ({
    value: { kind: 'file', size: shape.size ?? files[e.path]?.length ?? 0, mtimeMs: 0, isLink: false },
  }))
  on('fs.read', ($, e) => {
    shape.onRead?.()

    return { value: files[e.path] ?? '' }
  })
  on('fs.list', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    if (e.component === 'PromptHint') tails.push(e.props.tail)

    return { type: 'engine', ref: 0 }
  })

  return mock.clock(on, { now })
}

async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
}

describe('format', () => {
  test('stamps a message with its weekday, date and time', () => {
    expect(stamp(at(10, 29), '2026-10-25', DEFAULTS)).toBe('Sun 25/10 · 10:29')
  })

  test("leaves the date out of today's messages when asked, not out of older ones", () => {
    const settings = { ...DEFAULTS, todayDate: false }
    expect(stamp(at(10, 29), '2026-10-25', settings)).toBe('10:29')
    expect(stamp(at(10, 29, 23), '2026-10-25', settings)).toBe('Fri 23/10 · 10:29')
  })

  test('writes the other date formats and a 12-hour clock', () => {
    expect(stamp(at(0, 5), '', { ...DEFAULTS, dateFormat: '2026-10-25', clock: '12h' })).toBe('2026-10-25 · 12:05 am')
    expect(stamp(at(14, 5), '', { ...DEFAULTS, dateFormat: 'Sun 10/25' })).toBe('Sun 10/25 · 14:05')
    expect(formatTime(at(12, 0), '12h')).toBe('12:00 pm')
  })

  test('counts how long ago in minutes, hours and days', () => {
    expect(ago(30_000)).toBe('just now')
    expect(ago(5 * 60_000)).toBe('5m ago')
    expect(ago(125 * 60_000)).toBe('2h ago')
    expect(ago(50 * 3_600_000)).toBe('2d ago')
  })

  test('names the day in the last message line only when it is not today', () => {
    expect(lastMessageLine(at(10, 29), at(12, 31), DEFAULTS)).toBe('last message 10:29 · 2h ago')
    expect(lastMessageLine(at(10, 29, 23), at(12, 31), DEFAULTS)).toBe('last message Fri 23/10 10:29 · 2d ago')
  })
})

describe('transcript', () => {
  test("reads every prompt row's time, and the person's last", () => {
    const sent = parseSent(LINES.join('\n'))

    expect([...sent.times.keys()]).toEqual(['u1', 'n1', 'u2'])
    expect(sent.times.get('u1')).toBe(at(10, 29))
    expect(sent.last).toBe(at(12, 5))
  })

  test('takes a notification after the last prompt as no message of the person', () => {
    expect(parseSent([prompt('u1', at(10, 29)), prompt('n1', at(11, 0), 'task-notification')].join('\n')).last).toBe(
      at(10, 29),
    )
  })

  test('names the folder Claude Code keeps a project in', () => {
    expect(projectFolder('/Users/ana/Dev/claude-code.tweaks')).toBe('-Users-ana-Dev-claude-code-tweaks')
  })
})

describe('time on the messages', () => {
  test("a resumed session's message shows when it was sent", async ($, on) => {
    const clock = world(on, LINES, at(12, 31))
    await startSession($)

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId: 'u1', props: userMessage() })
    await clock.advance(300)

    expect((await ui.find({ type: 'Text', text: /10:29/ }))?.text).toBe('Sun 25/10 · 10:29')
    await ui.unmount()
  })

  test('a new message shows the time it is sent, before the transcript has it', async ($, on) => {
    const clock = world(on, LINES, at(12, 31))
    await startSession($)

    const placeholder = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'UserMessage',
      requestId: 'placeholder',
      props: userMessage(),
    })
    expect((await placeholder.find({ type: 'Text', text: /12:31/ }))?.text).toBe('Sun 25/10 · 12:31')
    await placeholder.unmount()

    const recorded = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId: 'u9', props: userMessage() })
    expect((await recorded.find({ type: 'Text', text: /12:31/ }))?.text).toBe('Sun 25/10 · 12:31')
    await clock.advance(300)
    await recorded.unmount()
  })

  test('the frame goes around the time and the message', async ($, on) => {
    const clock = world(on, LINES, at(12, 31))
    await startSession($)

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId: 'u2', props: userMessage() })
    await clock.advance(300)

    expect(await ui.drawn()).toMatchObject({
      type: 'Box',
      props: { borderStyle: 'round', borderColor: 'suggestion' },
      children: [{ type: 'Box', children: [{ type: 'Box', children: [{ type: 'Box', children: [{ type: 'Text' }] }, { type: 'Box', props: { marginTop: -1 } }] }] }],
    })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('Sun 25/10 · 12:05')
    await ui.unmount()
  })

  test('a notification, a message from another session and the desktop app draw as without the plugin', async ($, on) => {
    world(on, LINES, at(12, 31))
    await startSession($)

    const rows: { surface: RenderSurface; origin: PromptOrigin }[] = [
      { surface: 'terminal', origin: { kind: 'task-notification' } },
      { surface: 'terminal', origin: { kind: 'peer' } },
      { surface: 'desktop', origin: COMPOSER },
    ]
    for (const { surface, origin } of rows) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'UserMessage', requestId: 'u1', props: userMessage(origin) })
      expect(await ui.drawn()).toMatchObject({ type: 'engine' })
      await ui.unmount()
    }
  })

  test('a row the transcript never holds is looked for three times, then left alone', async ($, on) => {
    let reads = 0
    const clock = world(on, LINES, at(12, 31), { onRead: () => (reads += 1) })
    await startSession($)
    await clock.advance(300)
    reads = 0

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId: 'gone', props: userMessage() })
    await clock.advance(10_000)
    await ui.redraw()
    await clock.advance(10_000)

    expect(reads).toBe(3)
    expect((await ui.find({ type: 'Text' }))?.text).toBe(' ')
    await ui.unmount()
  })

  test('a transcript too large to read whole is filtered by grep', async ($, on) => {
    const clock = world(on, LINES, at(12, 31), { size: 50 * 1024 * 1024 })
    const runs: (readonly string[])[] = []
    on('process.run', ($, e) => {
      runs.push(e.argv)

      const stdout = [LINES[0], LINES[3]].join('\n')

      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    await startSession($)

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId: 'u1', props: userMessage() })
    await clock.advance(300)

    expect(runs[0]).toEqual(['grep', '-F', '-e', '"origin":{"kind":"', TRANSCRIPT])
    expect((await ui.find({ type: 'Text' }))?.text).toBe('Sun 25/10 · 10:29')
    await ui.unmount()
  })
})

describe('last message line', () => {
  const hint: RenderPropsOf['PromptHint'] = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

  test('says when the person last wrote, and counts on each minute', async ($, on) => {
    const clock = world(on, LINES, at(13, 4) + 30_000)
    await startSession($)
    await clock.advance(300)

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'PromptHint', props: hint })
    expect(tails.at(-1)).toBe('last message 12:05 · 59m ago')

    await clock.advance(60_000)
    expect(tails.at(-1)).toBe('last message 12:05 · 1h ago')
    await ui.unmount()
  })

  test('says nothing before the first message', async ($, on) => {
    const clock = world(on, [], at(13, 4))
    await startSession($)
    await clock.advance(300)

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'PromptHint', props: hint })
    expect(tails.at(-1)).toBeUndefined()
    await ui.unmount()
  })
})

describe('switched off', () => {
  const OFF = { messageTime: false, messageFrame: false, lastMessage: false }

  test('each tweak off leaves Claude Code drawing as without the plugin', { options: OFF }, async ($, on) => {
    const clock = world(on, LINES, at(12, 31))
    await startSession($)
    await clock.advance(300)

    const row = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId: 'u1', props: userMessage() })
    expect(await row.drawn()).toMatchObject({ type: 'engine' })
    await row.unmount()

    const hint = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect(tails).toEqual([undefined])
    await hint.unmount()
  })

  test('the frame alone pulls the message over the blank row above it', { options: { messageTime: false } }, async ($, on) => {
    world(on, LINES, at(12, 31))
    await startSession($)

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId: 'u1', props: userMessage() })
    expect(await ui.drawn()).toMatchObject({
      type: 'Box',
      props: { borderStyle: 'round' },
      children: [{ type: 'Box', props: { marginTop: -1 }, children: [{ type: 'engine' }] }],
    })
    await ui.unmount()
  })
})
