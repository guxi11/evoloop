import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exists, readIf, walk } from '../util.mjs'

const DIRS = ['rules', 'skills', 'commands', 'agents']

const SCRIPTS = {
  sync: 'evoloop sync',
  check: 'evoloop check',
  adopt: 'evoloop adopt',
  status: 'evoloop status',
}

// Our own version, for the devDependency range we scaffold. This is the one
// place import.meta.url is the right anchor: it is package metadata, not a
// source path in the repo being rendered.
const selfVersion = () =>
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

// An unnarrowed init leaves `targets` out entirely rather than freezing today's
// list into the repo: absent means every target evoloop knows, so installing a
// new CLI is enough to have it rendered into.
const configText = targets => `export default {
  sources: {
    rules: 'rules',
    skills: 'skills',
    commands: 'commands',
    agents: 'agents',
    mcp: 'mcp.json',
  },
${targets.length ? `  targets: [${targets.map(t => `'${t}'`).join(', ')}],\n` : ''}}
`

// git cannot track an empty directory, so a source dir with nothing in it needs
// a keepfile — one that already has content does not.
const bare = dir => !exists(dir) || readdirSync(dir).length === 0

// Skills the package ships — currently the one that teaches an agent how to
// drive evoloop. They are seeded into the repo rather than rendered straight
// into the targets: the config repo is the accurate copy of everything a target
// holds, and a skill the repo cannot show you is a skill you cannot edit.
// Anchoring on import.meta.url is right here and nowhere else: these are the
// package's own files, not sources of the repo being rendered.
const SEEDS = fileURLToPath(new URL('../../skills', import.meta.url))

// `sources.skills` is still the default at init time — it is this same run that
// writes the config naming it.
const seedSkills = () =>
  walk(SEEDS).map(p => [join('skills', relative(SEEDS, p)), readFileSync(p)])

// Paths are repo-relative; `init` joins them onto the root it resolved.
const plan = (root, targets) => {
  const seeds = seedSkills()
  const filled = new Set(seeds.map(([rel]) => rel.split(/[/\\]/)[0]))
  return [
    ['evoloop.config.mjs', configText(targets)],
    ['mcp.json', '{}\n'],
    ['.gitignore', 'node_modules/\n'],
    ...DIRS.filter(d => !filled.has(d) && bare(join(root, d))).map(d => [join(d, '.gitkeep'), '']),
    ...seeds,
  ]
}

const write = (p, content) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, content)
}

// The one file we may find already there and still want to touch. Additive
// only: an existing script or dependency range always wins.
const patchPackage = (root, check) => {
  const file = join(root, 'package.json')
  const before = readIf(file)
  const pkg = JSON.parse(before ?? '{}')
  const dep = { evoloop: `^${selfVersion()}` }
  // Spread the existing file first so key order survives; a fresh one gets the
  // minimal manifest a config repo needs.
  const after = {
    ...(before ? pkg : { name: 'aiconfig', private: true, type: 'module' }),
    scripts: { ...SCRIPTS, ...(pkg.scripts ?? {}) },
    devDependencies: { ...dep, ...(pkg.devDependencies ?? {}) },
  }
  const text = JSON.stringify(after, null, 2) + '\n'
  if (!check && text !== before) write(file, text)
  return { file: 'package.json', action: !before ? 'created' : text === before ? 'unchanged' : 'updated' }
}

export const init = (dir = process.cwd(), { targets = [], check = false } = {}) => {
  const root = resolve(dir)
  const items = plan(root, targets)
  // Snapshot before writing: after the writes everything exists, so `kept` has
  // to be derived from what was missing, not from a second existence check.
  const missing = items.filter(([rel]) => !exists(join(root, rel)))
  const fresh = new Set(missing.map(([rel]) => rel))
  if (!check) missing.forEach(([rel, content]) => write(join(root, rel), content))
  return {
    root,
    targets,
    created: [...fresh],
    kept: items.map(([rel]) => rel).filter(rel => !fresh.has(rel)),
    pkg: patchPackage(root, check),
  }
}

export const initReport = ({ root, targets, created, kept, pkg }, check) => [
  `${check ? 'would init' : 'init'}  ${root}`,
  `targets  ${targets.length ? targets.join(', ') : 'all known'}`,
  ...created.map(f => `  +  ${f}`),
  ...kept.map(f => `  =  ${f} (kept)`),
  `  ${pkg.action === 'unchanged' ? '=' : '+'}  ${pkg.file} (${pkg.action})`,
]
