import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { exists, readIf, walk } from '../util.mjs'
import { specs } from '../adapters/index.mjs'
import { readManifest } from '../manifest.mjs'

// The inverse of sync. Agents write skills straight into a target dir, and a
// one-way renderer makes that work invisible to git — the next `sync` does not
// destroy it (prune only touches what we wrote), but nothing ever brings it
// home either. Adopt walks the managed slots, subtracts what we rendered, and
// copies whatever is left back into the config repo.
const SLOTS = [
  { key: 'skills', dir: s => s.skillsDir, source: c => c.sources.skills, bundled: true },
  { key: 'commands', dir: s => s.commandsDir, source: c => c.sources.commands, bundled: false },
  { key: 'agents', dir: s => s.agentsDir, source: c => c.sources.agents, bundled: false, ext: s => s.agentsExt },
]

// Undo a target's private suffix so the repo keeps plain `.md`. Without this a
// Copilot `planner.agent.md` comes home under that name and the next sync
// renders `planner.agent.agent.md`.
const unext = (rel, ext) => (ext && rel.endsWith(ext) ? `${rel.slice(0, -ext.length)}.md` : rel)

// A skill is a directory of files; a command or agent is one file. Only the
// display groups differently — copying is per-file either way, so a file added
// by hand inside an already-vendored skill is adopted too.
const unitOf = (rel, bundled) => (bundled ? rel.split(/[/\\]/)[0] : rel)

const findable = (root, dir, owned) => {
  const abs = join(root, dir)
  return !exists(abs)
    ? []
    : walk(abs)
        .map(p => relative(root, p))
        .filter(rel => !owned.includes(rel))
        .map(rel => ({ from: join(root, rel), inSlot: relative(dir, rel) }))
}

const rehome = (f, slot, spec, source) => {
  const rel = unext(f.inSlot, slot.ext?.(spec))
  return { ...f, slot: slot.key, to: join(source, rel), unit: unitOf(rel, slot.bundled) }
}

const slotFindings = (spec, config, owned) =>
  SLOTS.flatMap(slot => {
    const dir = slot.dir(spec)
    const source = slot.source(config)
    if (!dir) return []
    return findable(spec.root, dir, owned)
      .map(f => rehome(f, slot, spec, source))
      // Already in the repo: the file is vendored but this target has not been
      // synced since, so it is drift for `sync` to fix, not something to adopt.
      .filter(f => !exists(f.to))
  })

// An entry we stamped is ours; one stamped by another tool is theirs; one with
// no stamp at all was added by hand and has no home in any repo. On a target we
// cannot stamp, our own entries look handwritten — the `name in mine` test is
// what keeps them from being adopted back on top of themselves.
const serverFindings = (spec, config) => {
  const patch = spec.patch({ mcp: {} })
  if (patch?.kind !== 'json' || !patch.managed?.key) return []
  const obj = JSON.parse(readIf(join(spec.root, patch.file)) ?? '{}')
  const mine = JSON.parse(readIf(config.sources.mcp) ?? '{}')
  // A target that reshapes servers on the way out must reshape them on the way
  // back, or the repo fills up with one tool's private dialect.
  const home = spec.mcpFrom ?? (cfg => cfg)
  return Object.entries(obj[patch.managed.key] ?? {})
    .filter(([name, cfg]) => !cfg?._managedBy && !(name in mine))
    .map(([name, cfg]) => ({ slot: 'mcp', unit: name, server: home(cfg), to: config.sources.mcp }))
}

const copy = ({ from, to }) => {
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

// One rewrite of mcp.json for the whole run — every target feeds the same file.
const mergeServers = (file, found) => {
  const mine = JSON.parse(readIf(file) ?? '{}')
  const added = Object.fromEntries(found.map(f => [f.unit, f.server]))
  writeFileSync(file, JSON.stringify({ ...mine, ...added }, null, 2) + '\n')
}

export const adopt = (config, { check = false, only = [] } = {}) => {
  const names = only.length ? only : config.targets
  const results = specs(names).map(spec => {
    if (!exists(spec.root)) return { name: spec.name, installed: false }
    const owned = readManifest(spec.root).files
    return {
      name: spec.name,
      installed: true,
      found: [...slotFindings(spec, config, owned), ...serverFindings(spec, config)],
    }
  })

  const found = results.flatMap(r => r.found ?? [])
  if (!check) {
    // Two targets can hold the same untracked skill; it lands in the repo once.
    // The per-target report still lists both, so the overlap stays visible.
    const seen = new Set()
    const fresh = found.filter(f => !seen.has(f.to + f.unit) && seen.add(f.to + f.unit))
    fresh.filter(f => f.slot !== 'mcp').forEach(copy)
    const servers = fresh.filter(f => f.slot === 'mcp')
    if (servers.length) mergeServers(config.sources.mcp, servers)
  }
  return results
}

// Units, not files — an 18-file skill is one thing the user recognises.
const units = found =>
  Object.entries(
    found.reduce((acc, f) => ({ ...acc, [`${f.slot}/${f.unit}`]: (acc[`${f.slot}/${f.unit}`] ?? 0) + 1 }), {}),
  )

export const adoptReport = results =>
  results.map(r => {
    if (!r.installed) return `-  ${r.name}: not installed, skipped`
    const found = units(r.found)
    if (!found.length) return `=  ${r.name}: nothing untracked`
    return [
      `+  ${r.name}: ${found.length} untracked`,
      ...found.map(([u, n]) => `     ${u}${n > 1 ? `  (${n} files)` : ''}`),
    ].join('\n')
  })

export const hasFindings = results => results.some(r => r.found?.length)
