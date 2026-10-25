import type { EngineInterface } from 'claude-code'

// What one read of a transcript yields: when each prompt row was recorded, by
// its uuid, and when the person last sent one (0 when they never did).
export type Sent = { times: ReadonlyMap<string, number>; last: number }

export const NOTHING_SENT: Sent = { times: new Map(), last: 0 }

// Every prompt row carries an origin (the person's, a task notification's, a
// peer's); tool results and the engine's own rows do not. The same text keeps
// both reads below to those rows: a substring test, and grep's -F.
const ORIGIN = '"origin":{"kind":"'
// How the transcript stamps the person's own messages: typed, queued, or a
// suggestion they accepted; `bridge` for one sent from the phone or the web.
const PERSONS = new Set(['human', 'bridge'])
// What $.fs.read copies at most; a larger transcript is filtered by grep first.
const READ_LIMIT = 4 * 1024 * 1024

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
// cut and hashed is found by the search in transcriptPath instead.
export const projectFolder = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, '-')

async function configDir($: EngineInterface): Promise<string | undefined> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configured !== undefined && configured !== '') return configured

  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))

  return home === undefined ? undefined : `${home}/.claude`
}

// The session's transcript: under the folder of the directory it runs in,
// else under any project's folder (a worktree, a path too long to keep whole).
export async function transcriptPath($: EngineInterface, sessionId: string): Promise<string | undefined> {
  const config = await configDir($)
  if (config === undefined) return undefined

  const projects = `${config}/projects`
  const file = `${sessionId}.jsonl`
  const near = [...new Set([await $.session.root(), await $.session.cwd()])]
  for (const dir of near) {
    const path = `${projects}/${projectFolder(dir)}/${file}`
    if (await $.fs.exists(path)) return path
  }

  const folders = await $.fs.list(projects).catch(() => [])
  for (const folder of folders) {
    if (folder.kind !== 'dir') continue
    const path = `${projects}/${folder.name}/${file}`
    if (await $.fs.exists(path)) return path
  }

  return undefined
}

export async function readSent($: EngineInterface, path: string): Promise<Sent> {
  const { size } = await $.fs.stat(path)
  if (size <= READ_LIMIT) return parseSent(await $.fs.read(path))

  // grep exits 1 when nothing matches, and its output stops at 4 MiB: what
  // came is parsed, a line cut short skipped.
  const { stdout } = await $.process.run(['grep', '-F', '-e', ORIGIN, path], { timeoutMs: 10_000 })

  return parseSent(stdout)
}
