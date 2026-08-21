<p align="center">
  <samp>one git repo&nbsp;&nbsp;──sync──▶&nbsp;&nbsp;~/.claude&nbsp;&nbsp;~/.codex&nbsp;&nbsp;~/.codebuddy&nbsp;&nbsp;~/.gemini&nbsp;&nbsp;──adopt──▶&nbsp;&nbsp;back home</samp>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/evoloop"><img src="https://img.shields.io/npm/v/evoloop?style=flat-square&color=black" alt="npm"></a>
  <img src="https://img.shields.io/badge/targets-4-blue?style=flat-square" alt="targets">
  <img src="https://img.shields.io/badge/node-%E2%89%A520-green?style=flat-square" alt="node">
  <img src="https://img.shields.io/badge/deps-0-purple?style=flat-square" alt="dependencies">
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" alt="license">
</p>

# evoloop

<p align="center">
  <b>evoloop is a CLI that renders one git repo of rules, skills, commands, subagents and MCP servers into every AI coding CLI's native layout — and pulls agent-authored files back out.</b>
  <br>
  Your config and your agents evolve each other, on a loop.
</p>

<br>

---

```console
$ npx evoloop sync                    # one repo → every CLI's own layout

~  claude: 4 changed, 0 pruned
     CLAUDE.md
     skills/changelog/SKILL.md
     skills/evoloop/SKILL.md
     settings.json
~  codex: 4 changed, 0 pruned
     AGENTS.md
     skills/changelog/SKILL.md
     skills/evoloop/SKILL.md
     config.toml
-  codebuddy: not installed, skipped
-  gemini: not installed, skipped

# an agent then writes ~/.claude/skills/triage/SKILL.md by itself

$ npx evoloop adopt                   # the other direction

+  claude: 1 untracked
     skills/triage
=  codex: nothing untracked

adopted into the config repo — review the diff, then `evoloop sync`

$ npx evoloop sync                    # codex has it now too

=  claude: 0 changed, 0 pruned
~  codex: 1 changed, 0 pruned
     skills/triage/SKILL.md
```

<br>

---

## Why not symlinks

|  | symlinks | copy-paste | evoloop |
|---|---|---|---|
| four tools, four layouts | breaks on the first disagreement | four copies drifting | rendered per target |
| agent writes its own file into the tree | clobbered | lost | `adopt` brings it home |
| target not installed on this machine | dangling link | — | skipped, never created |
| which files are generated? | guess | guess | `.evoloop-manifest.json` |
| handwritten file in the same directory | in the way | in the way | invisible to sync |

Every AI CLI invented its own home directory, its own instruction file, its own skills folder, its own place to declare MCP servers. evoloop renders instead of linking, and keeps a manifest of exactly what it wrote — so the generated tree and the handwritten tree coexist in one directory.

## Look once and you can use it

- ✓ `rules/*.md` — every file concatenated in sorted path order into `CLAUDE.md` / `AGENTS.md` / `CODEBUDDY.md` / `GEMINI.md`
- ✓ `skills/<name>/SKILL.md` — [agentskills.io](https://agentskills.io) layout; the directory name is the skill name, and everything beside it ships along, binaries included
- ✓ `mcp.json` — the shape every client already uses; rewritten into `settings.json` or `config.toml` per target
- ✓ `targets: [claude, codex]` frontmatter scopes any rule, skill, command or agent to a subset; absent means all four
- ✗ Never edit `~/.claude` and friends — that is build output. Edit the repo, then `evoloop sync`

## Quick start

```bash
mkdir myaiconfig && cd myaiconfig && git init
npx evoloop init      # config, source dirs, npm scripts, and the evoloop skill
npx evoloop sync      # render into every installed target
```

`init` never overwrites an existing file, so it is safe to re-run on an established repo to pick up whatever is missing. `--targets claude,codex` narrows the list; `--dry-run` shows the plan.

The config it writes is the anchor — every command walks up from the current directory until it finds one. Both keys are optional; these are the defaults:

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

## Commands

```
evoloop init [dir] [--targets a,b]      scaffold a config repo here
evoloop sync [--only a,b] [--dry-run]   render and install
evoloop check [--only a,b]              exit 1 on drift (CI / pre-commit)
evoloop adopt [--only a,b] [--dry-run]  pull untracked target content back in
evoloop status                          show what the config repo contains
evoloop targets                         list known targets
```

`--dry-run` reports without writing and always exits 0; `check` is the gate that exits 1.

## Targets

| target | root | instructions | skills | commands | agents | MCP |
|---|---|---|---|---|---|---|
| `claude` | `~/.claude` | `CLAUDE.md` | `skills/` | `commands/` | `agents/` | `settings.json` |
| `codex` | `~/.codex` | `AGENTS.md` | `skills/` | `prompts/` | — | `config.toml` |
| `codebuddy` | `~/.codebuddy`&nbsp;\* | `CODEBUDDY.md` | `skills/` | `commands/` | `agents/` | `mcp.json` |
| `gemini` | `~/.gemini` | `GEMINI.md` | — | — | — | `settings.json` |

Codex has no notion of slash commands, so reusable prompts are the nearest slot. Anything a target has no slot for is reported in the sync output, never silently dropped.

\* CodeBuddy shipped as `~/.codebuddy-cli` before `~/.codebuddy`. Roots are a candidate list probed in order — the first that exists wins, so either vintage is managed. With both present the newer path is used and the legacy directory is left frozen rather than double-managed.

## The ownership model

evoloop writes into directories it does not own, next to files you wrote by hand. Four rules keep that safe:

- **Everything generated is stamped** — instruction files carry a `GENERATED by evoloop` banner, MCP entries carry `_managedBy: evoloop`
- **The manifest is the only license to overwrite** — `.evoloop-manifest.json` under each target root lists every rendered path plus the `root` of the repo that rendered it; a file you added by hand is invisible to sync and to pruning
- **Foreign files are backed up before adoption** — a handwritten `CLAUDE.md` is copied to `.evoloop-backups/` before the first sync touches it
- **Settings are patched, not replaced** — JSON merged key by key, `config.toml` confined to a `# >>> evoloop managed` region; a server stamped by another tool is left alone and reported as a conflict

## Letting the agent drive

`init` seeds `skills/evoloop/SKILL.md` into your repo, and the next sync installs it into every target with a skills slot. From then on the CLIs configured by the repo know how to change the repo:

> **you:** add a rule that commit messages stay under 50 chars
> **agent:** *(writes `rules/git.md`, runs `evoloop sync`)*

> **you:** 把刚才写的那个 skill 同步一下
> **agent:** *(runs `evoloop adopt`, then `evoloop sync`, then shows the diff)*

It finds your repo through the `root` breadcrumb in `.evoloop-manifest.json`, so the two repos stay separable: evoloop is installed once, the config repo is whatever this machine is bound to, and the binding lives in neither. Once seeded the skill is yours — edit it, scope it with `targets:` frontmatter, or delete it.

This is why there is no MCP server. The interface is already a CLI plus a git repo; a skill costs nothing at rest and reaches every target through the pipeline evoloop already owns.

## Programmatic use

```js
import { loadConfig, sync, report, hasDrift } from 'evoloop'

const config = await loadConfig()
const results = sync(config, { check: true, only: ['claude'] })
console.log(report(results).join('\n'))
if (hasDrift(results)) process.exit(1)
```

`evoloop/adapters` exports `specs`, `specNames` and `render` for inspecting or extending the target table.

<br>

---

<p align="center">
  <a href="https://www.npmjs.com/package/evoloop">npm</a> ·
  <a href="https://agentskills.io">skill format</a> ·
  <a href="https://github.com/guxi11/evoloop/issues">issues</a>
</p>

<p align="center">
  <sub>MIT</sub>
</p>
