import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { exists, readIf, walk, parseFrontmatter } from './util.mjs'

// A doc opts out of targets via `targets: [claude, codex]` frontmatter; absent means all.
export const wants = (meta, target) => !meta.targets || meta.targets.includes(target)

const loadDocs = (dir, kind) =>
  walk(dir)
    .filter(p => p.endsWith('.md'))
    .sort()
    .map(p => {
      const { meta, body } = parseFrontmatter(readFileSync(p, 'utf8'))
      return { kind, path: relative(dir, p), name: meta.name ?? basename(p, '.md'), meta, body }
    })

// Skills follow the agentskills.io spec: <dir>/<name>/SKILL.md, name === parent dir.
// Bundled assets are read as Buffers — a skill may ship images, fonts or archives,
// and utf8 round-tripping would silently replace every invalid byte with U+FFFD.
const loadSkills = dir =>
  (exists(dir) ? readdirSync(dir).sort() : [])
    .filter(n => !n.startsWith('.') && exists(join(dir, n, 'SKILL.md')))
    .map(n => {
      const { meta, body } = parseFrontmatter(readFileSync(join(dir, n, 'SKILL.md'), 'utf8'))
      return {
        name: meta.name ?? n,
        description: meta.description ?? '',
        meta,
        body,
        files: walk(join(dir, n)).sort().map(p => ({ rel: relative(dir, p), content: readFileSync(p) })),
      }
    })

export const loadIR = ({ sources }) => ({
  rules: loadDocs(sources.rules, 'rule'),
  commands: loadDocs(sources.commands, 'command'),
  agents: loadDocs(sources.agents, 'agent'),
  skills: loadSkills(sources.skills),
  mcp: JSON.parse(readIf(sources.mcp) ?? '{}'),
})
