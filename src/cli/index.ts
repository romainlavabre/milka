// Command line interface: `milka run` for CI, imports, OpenAPI export and the MCP server.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { environmentValues, secretsFromProcessEnv } from '../core/environment'
import { WorkspaceStore } from '../core/layout/store'
import { ANSI_COLORS, NO_COLORS, consoleCase, consoleSummary, jsonReport, junitReport } from '../core/reporters'
import { runCollection, type RunSummary } from '../core/runner'
import { resolveTarget, UsageError } from './workspace'

export interface CliIo {
  stdout(text: string): void
  stderr(text: string): void
  cwd: string
  env: Record<string, string | undefined>
  /** Colors on the terminal. */
  color: boolean
  version: string
}

export const COMMANDS = ['run', 'import', 'export', 'mcp', 'help', 'version', '--help', '-h', '--version', '-v']

const HELP = `Milka — API client with git-backed workspaces

Usage:
  milka                                 Open the app
  milka run <path> [options]            Run requests and their tests (CI)
  milka help                            Show this help

milka run <path>
  <path> is a workspace, a collection folder, a folder inside it or a request file,
  e.g. collections/users-api or collections/users-api/admin/list-users.yaml.

  --env <name>             Environment to use (name or file name)
  --env-var <name=value>   Set a variable, overriding the environment (repeatable).
                           Secret values can also come from MILKA_SECRET_<NAME> variables.
  --reporter <type=file>   Write a report: junit=report.xml or json=report.json (repeatable)
  --all-bodies             Run every body of the requests that have several
  --tags <a,b>             Only requests with one of these tags
  --exclude-tags <a,b>     Skip requests with one of these tags
  --bail                   Stop at the first failure
  --insecure               Accept invalid TLS certificates
  --delay <ms>             Pause between requests

  Exit code: 0 when every request passed, 1 when a request or test failed, 2 on usage errors.
`

function list(value: string | undefined): string[] | undefined {
  return value
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseVars(values: string[] | undefined): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const entry of values ?? []) {
    const eq = entry.indexOf('=')
    if (eq <= 0) throw new UsageError(`--env-var expects name=value, got "${entry}"`)
    vars[entry.slice(0, eq)] = entry.slice(eq + 1)
  }
  return vars
}

async function run(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      env: { type: 'string' },
      'env-var': { type: 'string', multiple: true },
      reporter: { type: 'string', multiple: true },
      'all-bodies': { type: 'boolean' },
      tags: { type: 'string' },
      'exclude-tags': { type: 'string' },
      bail: { type: 'boolean' },
      insecure: { type: 'boolean' },
      delay: { type: 'string' }
    }
  })
  if (positionals.length !== 1) throw new UsageError('milka run expects one path: milka run collections/<collection>')
  const reporters = (values.reporter ?? []).map((spec) => {
    const [type, file] = spec.split('=')
    if (!['junit', 'json'].includes(type) || !file) throw new UsageError(`--reporter expects junit=<file> or json=<file>, got "${spec}"`)
    return { type, file: resolve(io.cwd, file) }
  })
  const overrides = parseVars(values['env-var'])
  const target = resolveTarget(positionals[0], io.cwd)
  const store = new WorkspaceStore(target.root)
  const collections = target.collection ? [target.collection] : store.listCollections().map((c) => c.slug)
  if (collections.length === 0) throw new UsageError('No collection to run')
  const colors = io.color ? ANSI_COLORS : NO_COLORS

  const summaries: RunSummary[] = []
  for (const collection of collections) {
    const envSlug = values.env ? store.findEnvironment(collection, values.env) : null
    const secretNames = envSlug ? store.readEnvironment(collection, envSlug).secrets : []
    const environment = environmentValues(store, collection, envSlug, secretsFromProcessEnv(secretNames, io.env))
    environment.vars = { ...environment.vars, ...overrides }
    const missing = secretNames.filter((name) => environment.vars[name] === undefined)
    const name = store.readCollection(collection).name
    io.stdout(`\n${colors.bold(name)}${environment.name ? colors.dim(` · ${environment.name}`) : ''}\n`)
    if (missing.length) io.stderr(colors.yellow(`  Secrets without value: ${missing.join(', ')} (use --env-var or MILKA_SECRET_<NAME>)\n`))
    const summary = await runCollection({
      store,
      collection,
      path: target.path,
      environment,
      processEnv: io.env,
      insecure: values.insecure,
      allBodies: values['all-bodies'],
      bail: values.bail,
      tags: list(values.tags),
      excludeTags: list(values['exclude-tags']),
      delayMs: values.delay ? Number(values.delay) : undefined,
      onCase: (runCase) => io.stdout(consoleCase(runCase, colors).join('\n') + '\n')
    })
    summaries.push(summary)
    if (values.bail && summary.failed > 0) break
  }

  const total: RunSummary = summaries.reduce((acc, s) => ({
    ...acc,
    durationMs: acc.durationMs + s.durationMs,
    passed: acc.passed + s.passed,
    failed: acc.failed + s.failed,
    skipped: acc.skipped + s.skipped,
    testsPassed: acc.testsPassed + s.testsPassed,
    testsFailed: acc.testsFailed + s.testsFailed
  }))
  io.stdout(`\n${consoleSummary(total, colors)}\n`)
  for (const reporter of reporters) {
    mkdirSync(dirname(reporter.file), { recursive: true })
    writeFileSync(reporter.file, reporter.type === 'junit' ? junitReport(summaries) : jsonReport(summaries))
    io.stdout(colors.dim(`Report written to ${reporter.file}\n`))
  }
  return total.failed > 0 ? 1 : 0
}

/** Runs a command; returns the process exit code. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv
  try {
    switch (command) {
      case 'run':
        return await run(args, io)
      case 'version':
      case '--version':
      case '-v':
        io.stdout(`${io.version}\n`)
        return 0
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        io.stdout(HELP)
        return 0
      default:
        throw new UsageError(`Unknown command "${command}"`)
    }
  } catch (error) {
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      io.stderr(`milka: ${(error as Error).message}\nRun "milka help" for usage.\n`)
      return 2
    }
    io.stderr(`milka: ${(error as Error).message}\n`)
    return 1
  }
}
