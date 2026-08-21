import { writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { exists, readIf, readBuf, deepMerge, spliceManaged } from '../util.mjs'
import { loadIR } from '../ir.mjs'
import { adapters, MANAGED_BY } from '../adapters/index.mjs'
import { MANIFEST, BACKUPS, readManifest } from '../manifest.mjs'

const buf = v => (Buffer.isBuffer(v) ? v : Buffer.from(v))

const write = (p, content) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, buf(content))
}

// Preserve a pre-existing file we did not write before overwriting it. Without this
// a first sync silently eats a handwritten CLAUDE.md / AGENTS.md.
const backup = (root, rel, stamp) => {
  const from = join(root, rel)
  const to = join(root, BACKUPS, `${rel.replace(/[/\\]/g, '_')}.${stamp}.bak`)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  return join(BACKUPS, `${rel.replace(/[/\\]/g, '_')}.${stamp}.bak`)
}

// Merge our entries into a foreign settings file. Entries we wrote on a previous run
// and no longer emit are removed; entries another tool owns are left strictly alone.
const patchJson = (before, patch, prevManaged) => {
  const obj = JSON.parse(before ?? '{}')
  const { key, entries } = patch.managed ?? { key: null, entries: {} }
  const merged = deepMerge(obj, patch.merge ?? {})
  if (!key) return { after: merged, wrote: [], conflicts: [] }

  const existing = obj[key] ?? {}
  const foreign = n => existing[n]?._managedBy && existing[n]._managedBy !== MANAGED_BY
  const conflicts = Object.keys(entries).filter(foreign)

  const stamped = Object.fromEntries(
    Object.entries(entries)
      .filter(([n]) => !foreign(n))
      .map(([n, cfg]) => [n, { ...cfg, _managedBy: MANAGED_BY }]),
  )
  // Drop only what we previously owned and no longer emit.
  const kept = Object.fromEntries(
    Object.entries(existing).filter(([n]) => !(prevManaged.includes(n) && !(n in stamped))),
  )
  const section = { ...kept, ...stamped }
  const after =
    Object.keys(section).length || key in obj ? { ...merged, [key]: section } : merged
  return { after, wrote: Object.keys(stamped), conflicts }
}

const applyPatch = (root, patch, prev, check) => {
  if (!patch) return { changed: [], managed: {}, conflicts: [] }
  const target = join(root, patch.file)
  const before = readIf(target)
  const prevManaged = prev.managed?.[patch.file]?.[patch.managed?.key] ?? []

  if (patch.kind === 'marked') {
    const after = spliceManaged(before, patch.value, patch.open, patch.close)
    if (!check && after !== before) write(target, after)
    return { changed: after === before ? [] : [patch.file], managed: {}, conflicts: [] }
  }

  const { after, wrote, conflicts } = patchJson(before, patch, prevManaged)
  const text = JSON.stringify(after, null, 2) + '\n'
  if (!check && text !== before) write(target, text)
  return {
    changed: text === before ? [] : [patch.file],
    managed: patch.managed?.key ? { [patch.file]: { [patch.managed.key]: wrote } } : {},
    conflicts,
  }
}

// Prune only what a previous run wrote. Files the user added by hand are never
// touched — this is why we never wipe a target directory wholesale.
const prune = (root, previous, current, check) => {
  const stale = previous.filter(p => !current.includes(p))
  if (!check) stale.forEach(p => exists(join(root, p)) && rmSync(join(root, p), { force: true }))
  return stale
}

const emit = (adapter, check, stamp) => {
  const { name, root, files, patch, dropped } = adapter
  if (!exists(root)) return { name, installed: false }

  const prev = readManifest(root)
  const paths = Object.keys(files)
  // Byte comparison — a utf8 round-trip would corrupt bundled binary assets.
  const changed = paths.filter(rel => !readBuf(join(root, rel))?.equals(buf(files[rel])))
  const adopted = changed.filter(rel => !prev.files.includes(rel) && exists(join(root, rel)))

  const backedUp = check ? adopted.map(rel => `${rel} (would back up)`) : adopted.map(rel => backup(root, rel, stamp))
  if (!check) changed.forEach(rel => write(join(root, rel), files[rel]))

  const patched = applyPatch(root, patch, prev, check)
  const stale = prune(root, prev.files, paths, check)
  if (!check) write(join(root, MANIFEST), JSON.stringify({ files: paths.sort(), managed: patched.managed }, null, 2) + '\n')

  return {
    name,
    installed: true,
    changed: [...changed, ...patched.changed],
    stale,
    dropped,
    backedUp,
    conflicts: patched.conflicts,
  }
}

export const sync = (config, { check = false, only = [] } = {}) => {
  const ir = loadIR(config)
  const names = only.length ? only : config.targets
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return adapters(names, ir).map(a => emit(a, check, stamp))
}

export const report = results =>
  results.map(r => {
    if (!r.installed) return `-  ${r.name}: not installed, skipped`
    const notes = Object.entries(r.dropped ?? {}).map(([k, n]) => `${n} ${k} dropped: target has no slot`)
    const head = `${r.changed.length || r.stale.length ? '~' : '='}  ${r.name}: ${r.changed.length} changed, ${r.stale.length} pruned`
    return [
      head,
      ...r.changed.map(c => `     ${c}`),
      ...r.backedUp.map(b => `     backed up  ${b}`),
      ...r.conflicts.map(c => `     !  ${c}: owned by another tool, left untouched`),
      ...notes.map(n => `     !  ${n}`),
    ].join('\n')
  })

export const hasDrift = results => results.some(r => r.installed && (r.changed.length || r.stale.length))
