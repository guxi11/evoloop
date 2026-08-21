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

  // A target with a closed schema rejects our stamp, so it goes in unmarked and
  // the manifest alone records ownership. Conflict detection degrades there —
  // nothing to read a foreign owner off — which is why `stamp: false` is opt-in
  // per target rather than a global switch.
  const mark = patch.stamp === false ? cfg => cfg : cfg => ({ ...cfg, _managedBy: MANAGED_BY })
  const stamped = Object.fromEntries(
    Object.entries(entries)
      .filter(([n]) => !foreign(n))
      .map(([n, cfg]) => [n, mark(cfg)]),
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

// A target can move its managed block to a different file between versions —
// CodeBuddy went from settings.json to mcp.json. Entries we wrote into the old
// file are still ours and still stamped, but the new spec never looks at that
// file again, so nothing would ever reclaim them. Sweep every file a previous
// run recorded that we no longer patch. Only `kind: 'json'` patches record a
// `managed` section, so everything reachable here parses as JSON.
const sweepMoved = (root, patch, prev, check) =>
  Object.entries(prev.managed ?? {})
    .filter(([file]) => file !== patch?.file)
    .flatMap(([file, keys]) => {
      const target = join(root, file)
      const before = readIf(target)
      if (before === null) return []
      const after = Object.entries(keys).reduce((acc, [key, names]) => {
        const section = acc[key]
        if (!section) return acc
        // Ours to reclaim only if we still hold the stamp; a name another tool
        // took over in the meantime stays with them. An unstamped target never
        // wrote a stamp to check, so the manifest is the whole story there.
        const ours = cfg => patch?.stamp === false || cfg?._managedBy === MANAGED_BY
        const kept = Object.fromEntries(
          Object.entries(section).filter(([n, cfg]) => !(names.includes(n) && ours(cfg))),
        )
        return { ...acc, [key]: kept }
      }, JSON.parse(before))
      const text = JSON.stringify(after, null, 2) + '\n'
      if (text === before) return []
      if (!check) write(target, text)
      return [file]
    })

// Prune only what a previous run wrote. Files the user added by hand are never
// touched — this is why we never wipe a target directory wholesale.
const prune = (root, previous, current, check) => {
  const stale = previous.filter(p => !current.includes(p))
  if (!check) stale.forEach(p => exists(join(root, p)) && rmSync(join(root, p), { force: true }))
  return stale
}

const emit = (adapter, check, stamp, configRoot) => {
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
  const moved = sweepMoved(root, patch, prev, check)
  const stale = prune(root, prev.files, paths, check)
  // `root` here is the config repo, not the target: it is the only breadcrumb
  // pointing from a rendered tree back to the source, which is what lets an
  // agent reading a target dir find the repo it must edit instead.
  if (!check)
    write(
      join(root, MANIFEST),
      JSON.stringify({ root: configRoot, files: paths.sort(), managed: patched.managed }, null, 2) + '\n',
    )

  return {
    name,
    installed: true,
    changed: [...changed, ...patched.changed, ...moved],
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
  return adapters(names, ir).map(a => emit(a, check, stamp, config.root))
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
