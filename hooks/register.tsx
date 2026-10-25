import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, RenderInput, Register } from 'claude-code'

import { dayKey, lastMessageLine, stamp } from './format'
import { readSettings } from './settings'
import type { Settings } from './settings'
import { NOTHING_SENT, parseSent, projectFolder } from './transcript'
import type { Sent } from './transcript'

// Everything that talks to the engine is in this file: the plugin directory
// reads a mod's calls from the source, and follows `$` only into functions of
// the file that declares the hooks. The other modules are plain functions.

// When each of the person's messages was sent, and the last of them: what the
// time on a message and the last message line both draw from. The transcript
// is the one source, so a live session and a resumed one show the same time.
const sent = atom({ plugin: 'terminal-tweaks', key: 'sent' } as const, 0)
const lastSent = atom({ plugin: 'terminal-tweaks', key: 'lastSent' } as const, 0)
// Written on each new minute and each new day, so what reads them is drawn
// again: the last message line every minute, the stamps without today's date
// at midnight.
const minute = atom({ plugin: 'terminal-tweaks', key: 'minute' } as const, 0)
const today = atom({ plugin: 'terminal-tweaks', key: 'today' } as const, '')

const MINUTE_MS = 60_000
// The id the engine draws a prompt under in the moment before it is recorded;
// the next row drawn under an id of its own is that prompt.
const PLACEHOLDER = 'placeholder'
const PLACEHOLDER_MS = 5_000
// Rows drawn together (a resumed session draws all of them) share one read.
const GATHER_MS = 300
// A row the transcript does not hold yet is looked for again after these.
const RETRIES_MS = [1_000, 5_000]
// What $.fs.read copies at most; a larger transcript is filtered by grep first.
const READ_LIMIT = 4 * 1024 * 1024

// The person's own prompts: typed here, or sent from the phone or the web.
const isPersons = (kind: string): boolean => kind === 'composer' || kind === 'bridge'

// Bookkeeping for the reads, never stored: lost on a reload, after which the
// rows still missing a time ask again as they are drawn.
const waiting = new Set<string>()
const misses = new Map<string, number>()
// What a new prompt shows until the transcript says when it was recorded.
const provisional = new Map<string, number>()
let placeholderAt: number | undefined
let isScheduled = false
let found: { sessionId: string; path: string } | undefined

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

function registerMessageFrame(on: On, settings: Settings): void {
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

function registerMessageTime(on: On, settings: Settings): void {
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

function registerLastMessage(on: On, settings: Settings): void {
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

function registerSentTimes(on: On): void {
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

async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, minute, () => Math.floor(now / MINUTE_MS))

  const day = dayKey(now)
  if ((await read($, today)) !== day) await update($, today, () => day)
}

// Started with the session: on the minute, then every minute.
async function startClock($: EngineInterface): Promise<void> {
  await tick($)

  const now = await $.clock.now()
  $.clock.after(MINUTE_MS - (now % MINUTE_MS), () => {
    void tick($)
    $.clock.every(MINUTE_MS, () => void tick($))
  })
}

async function configDir($: EngineInterface): Promise<string | undefined> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configured !== undefined && configured !== '') return configured

  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))

  return home === undefined ? undefined : `${home}/.claude`
}

// The session's transcript: under the folder of the directory it runs in,
// else under any project's folder (a worktree, a path too long to keep whole).
async function transcriptPath($: EngineInterface, sessionId: string): Promise<string | undefined> {
  const config = await configDir($)
  if (config === undefined) return undefined

  const projects = `${config}/projects`
  const file = `${sessionId}.jsonl`
  const near = [...new Set([await $.session.root(), await $.session.cwd()])]
  for (const dir of near) {
    const path = `${projects}/${projectFolder(dir)}/${file}`
    if (await $.fs.exists(path)) return path
  }

  // A folder that cannot be listed ends the read in load(), as no transcript.
  const folders = await $.fs.list(projects)
  for (const folder of folders) {
    if (folder.kind !== 'dir') continue
    const path = `${projects}/${folder.name}/${file}`
    if (await $.fs.exists(path)) return path
  }

  return undefined
}

async function readSent($: EngineInterface, path: string): Promise<Sent> {
  const { size } = await $.fs.stat(path)
  if (size <= READ_LIMIT) return parseSent(await $.fs.read(path))

  // The prompt rows alone, by the text parseSent looks for (ORIGIN in
  // transcript.ts). grep exits 1 when nothing matches, and its output stops at
  // 4 MiB: what came is parsed, a line cut short skipped.
  const { stdout } = await $.process.run(['grep', '-F', '-e', '"origin":{"kind":"', path], { timeoutMs: 10_000 })

  return parseSent(stdout)
}

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
async function sentAt($: EngineInterface, e: Pick<RenderInput, 'requestId'>): Promise<number | undefined> {
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
function startSentTimes($: EngineInterface): void {
  schedule($, GATHER_MS)
}
