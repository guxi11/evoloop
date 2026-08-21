# evoloop

> Your config and your agents evolve each other, on a loop.
> One config repo, rendered into every AI CLI's native layout.

[![npm](https://img.shields.io/npm/v/evoloop.svg)](https://www.npmjs.com/package/evoloop)

You write rules, skills, slash commands, subagents and MCP servers once, in one
git repo. `evoloop sync` renders them into `~/.claude`, `~/.codex`,
`~/.codebuddy` and `~/.gemini` in each tool's own layout. When an agent writes a
new skill straight into a target directory, `evoloop adopt` brings it back home.

```
edit here ──sync──▶ ~/.claude   ~/.codex   ~/.codebuddy   ~/.gemini
    ▲                                                          │
    └──────────────────────── adopt ───────────────────────────┘
```

## Why

Every AI CLI invented its own home directory, its own instruction file, its own
skills folder, its own place to declare MCP servers. Keeping four of them in
sync by hand means four copies of the same rule drifting apart.

The usual fix is symlinks, and symlinks break the moment two tools disagree
about layout — or the moment an agent writes a file of its own into the tree.
evoloop renders instead, and keeps a manifest of exactly what it wrote, so the
generated tree and the handwritten tree can coexist in the same directory.

## Quickstart

Requires Node ≥ 20.

**1. Scaffold a config repo**

```bash
mkdir myaiconfig && cd myaiconfig && git init
npx evoloop init
```

That writes `evoloop.config.mjs`, the four source directories, an empty
`mcp.json`, a `.gitignore`, the npm scripts, and seeds `skills/evoloop/SKILL.md`
— the skill that teaches every agent on this machine how to edit the repo (see
[Letting the agent drive](#letting-the-agent-drive)).

`init` never overwrites a file that already exists, so it is safe to re-run on
an existing repo to pick up whatever is missing. `--targets claude,codex`
narrows the target list; `--dry-run` shows the plan.

**2. Read the config it wrote**

`evoloop.config.mjs` is the anchor — every command walks up from the current
directory until it finds one. Both keys are optional; these are the defaults.

```js
export default {
  sources: {
    rules: 'rules',
    skills: 'skills',
    commands: 'commands',
    agents: 'agents',
    mcp: 'mcp.json',
  },
  targets: ['claude', 'codex', 'codebuddy', 'gemini'],
}
```

**3. Write one rule**

`rules/style.md` — every `.md` under `rules/` is concatenated, in sorted path
order, into each target's instruction file.

```markdown
# Style

Functional first. Pure functions, composition over inheritance, no mutation.
```

**4. Add a skill** (optional)

Skills follow the [agentskills.io](https://agentskills.io) layout —
`skills/<name>/SKILL.md`, where the directory name is the skill name. Anything
else in the directory ships with it, binary assets included.

```markdown
---
name: changelog
description: Draft a changelog entry from the staged diff.
---

Read the staged diff and write one line per user-visible change.
```

**5. Add MCP servers** (optional)

`mcp.json`, in the shape every client already uses:

```json
{
  "context7": {
    "command": "npx",
    "args": ["-y", "@upstash/context7-mcp"]
  }
}
```

**6. Sync**

```bash
npx evoloop sync
```

```
~  claude: 3 changed, 0 pruned
     CLAUDE.md
     skills/changelog/SKILL.md
     settings.json
~  codex: 2 changed, 0 pruned
     AGENTS.md
     config.toml
-  gemini: not installed, skipped
```

Targets that aren't installed on this machine are skipped, not created. Commit
the repo, clone it on your next machine, run `npm install && npm run sync`.

## Letting the agent drive

`init` seeds `skills/evoloop/SKILL.md` into your repo, and the next `sync`
installs it into every target that has a skills slot. From then on the CLIs
configured by the repo know how to change the repo:

> **you:** add a rule that commit messages stay under 50 chars
> **agent:** *(writes `rules/git.md`, runs `evoloop sync`)*

> **you:** 把刚才写的那个 skill 同步一下
> **agent:** *(runs `evoloop adopt`, then `evoloop sync`, then shows the diff)*

The skill's first instruction is the important one: **never edit a target
directory** — those are build output. It finds your repo through the `root`
breadcrumb every sync writes into `<target>/.evoloop-manifest.json`, so the two
repos stay separable: evoloop is installed once, the config repo is whatever
this machine happens to be bound to, and the binding lives in neither.

Once seeded, the skill is yours — it lives in your repo like everything else, so
edit it, restrict it with `targets:` frontmatter, or delete it.

This is why there is no MCP server. The interface is already a CLI plus a git
repo; a skill costs nothing at rest, ships through the pipeline evoloop already
owns, and reaches every target at once.

## Commands

```
evoloop init [dir] [--targets a,b]      scaffold a config repo here
evoloop sync [--only a,b] [--dry-run]   render and install
evoloop check [--only a,b]              exit 1 on drift (CI / pre-commit)
evoloop adopt [--only a,b] [--dry-run]  pull untracked target content back in
evoloop status                          show what the config repo contains
evoloop targets                         list known targets
```

`--only claude,codex` narrows a run to specific targets. `--dry-run` reports
without writing and always exits 0; `check` is the CI gate that exits 1.

## Targets

| target | root | instructions | skills | commands | agents | MCP |
|---|---|---|---|---|---|---|
| `claude` | `~/.claude` | `CLAUDE.md` | `skills/` | `commands/` | `agents/` | `settings.json` |
| `codex` | `~/.codex` | `AGENTS.md` | `skills/` | `prompts/` | — | `config.toml` |
| `codebuddy` | `~/.codebuddy`&nbsp;\* | `CODEBUDDY.md` | `skills/` | `commands/` | `agents/` | `mcp.json` |
| `gemini` | `~/.gemini` | `GEMINI.md` | — | — | — | `settings.json` |

Codex has no notion of slash commands, so reusable prompts are the nearest slot.
Anything a target has no slot for is reported in the sync output, never silently
dropped.

\* CodeBuddy shipped as `~/.codebuddy-cli` before `~/.codebuddy`. Roots are a
candidate list, probed in order — the first that exists wins, so either vintage
is managed. With both present the newer path is used and the legacy directory is
left frozen rather than double-managed; delete it once you have migrated.

## Scoping a doc to some targets

Frontmatter opts a document out. Absent means every target.

```yaml
---
targets: [claude, codex]
---
```

Works on rules, skills, commands and agents alike.

## The ownership model

evoloop writes into directories it does not own, next to files you wrote by
hand. Four rules keep that safe:

- **Everything generated is stamped.** Instruction files carry a
  `GENERATED by evoloop` banner; MCP entries carry `_managedBy: evoloop`.
- **A manifest records every rendered path** in `.evoloop-manifest.json` under
  each target root, alongside the `root` of the repo that rendered it. Only
  files listed there are ever overwritten or pruned — a file you added by hand
  is invisible to sync.
- **Foreign files are backed up before adoption.** If your first sync would
  overwrite a handwritten `CLAUDE.md`, the original is copied to
  `.evoloop-backups/` first.
- **Settings files are patched, not replaced.** JSON settings are merged key by
  key; `config.toml` gets a marked region (`# >>> evoloop managed`) and
  everything outside it is preserved. An MCP server stamped by another tool is
  left strictly alone and reported as a conflict.

Pruning is equally narrow: when you delete a rule, sync removes only what a
previous run wrote and no longer emits.

## Adopt — the other direction

A one-way renderer makes agent-authored work invisible. An agent that writes
`~/.claude/skills/triage/SKILL.md` has created something no repo tracks: sync
won't destroy it (pruning only touches what evoloop wrote), but nothing ever
brings it home either.

`evoloop adopt` walks every managed slot, subtracts what the manifest says it
rendered, and copies the remainder into your config repo:

```bash
npx evoloop adopt --dry-run    # list what's untracked
npx evoloop adopt              # copy it home
git diff                       # review, then commit
```

Unstamped MCP servers found in a target's settings are merged into `mcp.json`
the same way. Adopting is safe to run at any time: the bytes already match, so
the next `sync` is a zero-write ownership handoff rather than a rewrite. Two
targets holding the same untracked skill adopt it once.

## Programmatic use

```js
import { loadConfig, sync, report, hasDrift } from 'evoloop'

const config = await loadConfig()
const results = sync(config, { check: true, only: ['claude'] })
console.log(report(results).join('\n'))
if (hasDrift(results)) process.exit(1)
```

`evoloop/adapters` exports `specs`, `specNames` and `render` for inspecting or
extending the target table.

## License

MIT
