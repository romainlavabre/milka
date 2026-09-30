// Reports of a run: JUnit XML for CI servers, JSON, and a console summary.
import { caseLabel, type RunCase, type RunSummary } from './results'

function xml(text: string): string {
  return (
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  )
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3)
}

function testcase(runCase: RunCase): string {
  const { result } = runCase
  const attributes = `classname="${xml(runCase.path)}" name="${xml(caseLabel(runCase))}" time="${seconds(result.durationMs)}"`
  const children: string[] = []
  if (result.skipped) children.push(`<skipped message="${xml(result.skipped)}"/>`)
  if (result.error)
    children.push(`<error message="${xml(result.error)}">${xml(result.logs.map((l) => `[${l.source}] ${l.message}`).join('\n'))}</error>`)
  const failures = result.tests.filter((t) => !t.passed)
  if (failures.length > 0) {
    const detail = failures.map((t) => `✗ ${t.name}${t.error ? `: ${t.error}` : ''}`).join('\n')
    children.push(
      `<failure message="${xml(`${failures.length} of ${result.tests.length} tests failed`)}" type="AssertionError">${xml(detail)}</failure>`
    )
  }
  if (result.response) {
    const passedTests = result.tests.filter((t) => t.passed).map((t) => `✓ ${t.name}`)
    children.push(
      `<system-out>${xml([`${result.request?.method} ${result.request?.url} → ${result.response.status}`, ...passedTests].join('\n'))}</system-out>`
    )
  }
  return children.length
    ? `    <testcase ${attributes}>\n      ${children.join('\n      ')}\n    </testcase>`
    : `    <testcase ${attributes}/>`
}

function counts(summary: RunSummary): { errors: number; failures: number } {
  return {
    errors: summary.cases.filter((c) => c.result.error).length,
    failures: summary.cases.filter((c) => !c.result.error && !c.passed).length
  }
}

/** JUnit XML, one test suite per collection and one test case per request (and body). */
export function junitReport(summaries: RunSummary[]): string {
  const total = summaries.reduce(
    (acc, s) => {
      const { errors, failures } = counts(s)
      return {
        tests: acc.tests + s.cases.length,
        errors: acc.errors + errors,
        failures: acc.failures + failures,
        ms: acc.ms + s.durationMs
      }
    },
    { tests: 0, errors: 0, failures: 0, ms: 0 }
  )
  const suites = summaries.flatMap((summary) => {
    const { errors, failures } = counts(summary)
    const attributes = `name="${xml(summary.collectionName)}" tests="${summary.cases.length}" failures="${failures}" errors="${errors}" skipped="${summary.skipped}" time="${seconds(summary.durationMs)}" timestamp="${summary.startedAt}"`
    return [`  <testsuite ${attributes}>`, ...summary.cases.map(testcase), '  </testsuite>']
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="Milka" tests="${total.tests}" failures="${total.failures}" errors="${total.errors}" time="${seconds(total.ms)}">`,
    ...suites,
    '</testsuites>',
    ''
  ].join('\n')
}

export function jsonReport(summaries: RunSummary[]): string {
  return JSON.stringify({ collections: summaries.map(jsonSummary) }, null, 2) + '\n'
}

function jsonSummary(summary: RunSummary): unknown {
  return {
    ...summary,
    cases: summary.cases.map((c) => ({
      path: c.path,
      name: c.name,
      bodyName: c.bodyName,
      passed: c.passed,
      skipped: c.result.skipped,
      error: c.result.error,
      method: c.result.request?.method ?? null,
      url: c.result.request?.url ?? null,
      status: c.result.response?.status ?? null,
      durationMs: c.result.durationMs,
      tests: c.result.tests,
      logs: c.result.logs
    }))
  }
}

export interface Colors {
  green(text: string): string
  red(text: string): string
  yellow(text: string): string
  dim(text: string): string
  bold(text: string): string
}

export const NO_COLORS: Colors = { green: (t) => t, red: (t) => t, yellow: (t) => t, dim: (t) => t, bold: (t) => t }

export const ANSI_COLORS: Colors = {
  green: (t) => `\x1b[32m${t}\x1b[39m`,
  red: (t) => `\x1b[31m${t}\x1b[39m`,
  yellow: (t) => `\x1b[33m${t}\x1b[39m`,
  dim: (t) => `\x1b[2m${t}\x1b[22m`,
  bold: (t) => `\x1b[1m${t}\x1b[22m`
}

/** One line per case, with its failing tests and errors below. */
export function consoleCase(runCase: RunCase, c: Colors): string[] {
  const { result } = runCase
  const status = result.response ? String(result.response.status) : result.skipped ? 'skip' : 'ERR'
  const mark = result.skipped ? c.yellow('○') : runCase.passed ? c.green('✓') : c.red('✗')
  const lines = [`  ${mark} ${caseLabel(runCase)} ${c.dim(`${status} · ${result.durationMs} ms`)}`]
  if (result.error) lines.push(`      ${c.red(result.error)}`)
  for (const test of result.tests.filter((t) => !t.passed))
    lines.push(`      ${c.red(`✗ ${test.name}`)}${test.error ? c.dim(` — ${test.error}`) : ''}`)
  return lines
}

export function consoleSummary(summary: RunSummary, c: Colors): string {
  const requests = [
    `${summary.passed} passed`,
    summary.failed ? c.red(`${summary.failed} failed`) : '',
    summary.skipped ? `${summary.skipped} skipped` : ''
  ]
  const tests = [`${summary.testsPassed} passed`, summary.testsFailed ? c.red(`${summary.testsFailed} failed`) : '']
  return `${c.bold('Requests:')} ${requests.filter(Boolean).join(', ')} · ${c.bold('Tests:')} ${tests.filter(Boolean).join(', ')} · ${(summary.durationMs / 1000).toFixed(2)} s`
}
