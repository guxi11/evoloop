#!/usr/bin/env node
import {
  loadConfig, loadIR, specNames,
  sync, report, hasDrift,
  adopt, adoptReport, hasFindings,
} from '../src/index.mjs'

const USAGE = `evoloop — render one config repo into every AI CLI's native layout

  evoloop sync [--only a,b] [--dry-run]   render and install
  evoloop check [--only a,b]              exit 1 on drift (CI / pre-commit)
  evoloop adopt [--only a,b] [--dry-run]  pull untracked target content back in
  evoloop status                          show what the config repo contains
  evoloop targets                         list known targets
`

// Flags that consume the next token when written with a space.
const VALUED = new Set(['only'])

const parseArgv = argv =>
  argv.reduce(
    (acc, a, i) => {
      if (acc.skip) return { ...acc, skip: false }
      if (!a.startsWith('--')) return { ...acc, _: [...acc._, a] }
      const [name, inline] = a.slice(2).split(/=(.*)/s)
      if (inline !== undefined) return { ...acc, flags: { ...acc.flags, [name]: inline } }
      const next = argv[i + 1]
      // Without this, a flag value is mistaken for the command name.
      return VALUED.has(name) && next && !next.startsWith('--')
        ? { ...acc, skip: true, flags: { ...acc.flags, [name]: next } }
        : { ...acc, flags: { ...acc.flags, [name]: true } }
    },
    { _: [], flags: {}, skip: false },
  )

const { _: positional, flags } = parseArgv(process.argv.slice(2))
const cmd = positional[0] ?? 'help'
const list = n => String(flags[n] ?? '').split(',').map(s => s.trim()).filter(Boolean)

const run = async () => {
  if (cmd === 'targets') return console.log(specNames().join('\n'))
  if (cmd === 'help' || flags.help) return console.log(USAGE)

  const only = list('only')
  const unknown = only.filter(n => !specNames().includes(n))
  if (unknown.length) throw new Error(`unknown target(s): ${unknown.join(', ')} — known: ${specNames().join(', ')}`)

  const config = await loadConfig()

  if (cmd === 'status') {
    const ir = loadIR(config)
    return console.log(
      [
        `config   ${config.file}`,
        `targets  ${config.targets.join(', ')}`,
        `rules    ${ir.rules.length}`,
        `skills   ${ir.skills.length}`,
        `commands ${ir.commands.length}`,
        `agents   ${ir.agents.length}`,
        `mcp      ${Object.keys(ir.mcp).length}`,
      ].join('\n'),
    )
  }

  if (cmd === 'adopt') {
    const results = adopt(config, { check: flags['dry-run'] === true, only })
    console.log(adoptReport(results).join('\n'))
    if (hasFindings(results) && flags['dry-run'] !== true) {
      console.error('\nadopted into the config repo — review the diff, then `evoloop sync`')
    }
    return
  }

  if (cmd !== 'sync' && cmd !== 'check') {
    console.error(`unknown command: ${cmd}\n\n${USAGE}`)
    process.exit(2)
  }

  const check = cmd === 'check' || flags['dry-run'] === true
  const results = sync(config, { check, only })
  console.log(report(results).join('\n'))

  // Only `check` is the CI gate; `--dry-run` is informational and always exits 0.
  if (cmd === 'check' && hasDrift(results)) {
    console.error('\ndrift detected — run `evoloop sync`')
    process.exit(1)
  }
}

run().catch(e => {
  console.error(`evoloop: ${e.message}`)
  process.exit(1)
})
