import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

export const exists = p => existsSync(p)
export const readIf = p => (existsSync(p) ? readFileSync(p, 'utf8') : null)
export const readBuf = p => (existsSync(p) ? readFileSync(p) : null)

// Editor/OS droppings and dependency trees must never be published into a target.
const IGNORED = new Set(['node_modules'])
const skip = n => n.startsWith('.') || IGNORED.has(n)

export const walk = dir =>
  !existsSync(dir)
    ? []
    : readdirSync(dir)
        .filter(n => !skip(n))
        .flatMap(n => {
          const p = join(dir, n)
          return statSync(p).isDirectory() ? walk(p) : [p]
        })

// `---\nyaml\n---\nbody`. Flat scalars and inline lists only — all our frontmatter needs.
export const parseFrontmatter = text => {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (!m) return { meta: {}, body: text }
  const meta = m[1].split('\n').reduce((acc, line) => {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line.trim())
    if (!kv) return acc
    const [, k, raw] = kv
    const v = raw.startsWith('[')
      ? raw.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
      : raw.replace(/^["']|["']$/g, '')
    return { ...acc, [k]: v }
  }, {})
  return { meta, body: text.slice(m[0].length) }
}

export const deepMerge = (base, patch) =>
  Object.entries(patch).reduce(
    (acc, [k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v) &&
      acc[k] && typeof acc[k] === 'object' && !Array.isArray(acc[k])
        ? { ...acc, [k]: deepMerge(acc[k], v) }
        : { ...acc, [k]: v },
    { ...base },
  )

// Minimal TOML emitter — we only ever emit [mcp_servers.*] tables.
const tomlValue = v =>
  Array.isArray(v)
    ? `[${v.map(tomlValue).join(', ')}]`
    : v && typeof v === 'object'
      ? `{ ${Object.entries(v).map(([k, x]) => `${k} = ${tomlValue(x)}`).join(', ')} }`
      : JSON.stringify(v)

export const tomlTables = (prefix, obj) =>
  Object.entries(obj)
    .map(([name, cfg]) =>
      [`[${prefix}.${name}]`, ...Object.entries(cfg).map(([k, v]) => `${k} = ${tomlValue(v)}`)].join('\n'),
    )
    .join('\n\n')

// Replace a marked region in a file we do not own, preserving everything outside it.
export const spliceManaged = (existing, block, open, close) => {
  const region = `${open}\n${block}\n${close}`
  const re = new RegExp(`${open}[\\s\\S]*?${close}`)
  return existing && re.test(existing)
    ? existing.replace(re, region)
    : `${(existing ?? '').trimEnd()}\n\n${region}\n`.trimStart()
}

export { basename }
