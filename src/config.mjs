import { dirname, join, resolve, isAbsolute } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { specNames } from './adapters/index.mjs'

const CONFIG = 'evoloop.config.mjs'

// Every known target by default: one a machine has not installed is reported and
// skipped, so an opt-out list would only go stale the day a new CLI is installed.
const DEFAULTS = {
  sources: { rules: 'rules', skills: 'skills', commands: 'commands', agents: 'agents', mcp: 'mcp.json' },
  targets: specNames(),
}

// Walk up from `start` looking for the config. This is the ONLY path anchor:
// never derive source paths from import.meta.url — under `npm link` the package
// resolves to its own real directory, not to the config repo being rendered.
export const findConfig = (start = process.cwd()) => {
  const up = dir => {
    const candidate = join(dir, CONFIG)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    return parent === dir ? null : up(parent)
  }
  return up(resolve(start))
}

export const loadConfig = async (start = process.cwd()) => {
  const file = findConfig(start)
  if (!file) throw new Error(`no ${CONFIG} found from ${start} upward`)
  const root = dirname(file)
  const user = (await import(pathToFileURL(file).href)).default ?? {}
  const abs = p => (isAbsolute(p) ? p : join(root, p))
  return {
    root,
    file,
    ...DEFAULTS,
    ...user,
    sources: Object.fromEntries(
      Object.entries({ ...DEFAULTS.sources, ...(user.sources ?? {}) }).map(([k, v]) => [k, abs(v)]),
    ),
  }
}
