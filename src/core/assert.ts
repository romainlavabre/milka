// Declarative assertions of the Assert tab: `res.status eq 201`.
import type { Assertion, AssertOperator } from './model'
import { OPERATOR_LABELS, UNARY_OPERATORS } from './assert-labels'
import { deepEqual } from './expect'
import { evaluate, type ScriptScope, type TestResult } from './script'

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Reads an expected value typed in the UI as text: 201 is a number, true a boolean, {…} JSON. */
export function coerceExpected(expected: unknown, actual: unknown): unknown {
  if (typeof expected !== 'string') return expected
  const text = expected.trim()
  if (typeof actual === 'number' && text !== '' && !Number.isNaN(Number(text))) return Number(text)
  if (typeof actual === 'boolean' && (text === 'true' || text === 'false')) return text === 'true'
  if (actual === null && text === 'null') return null
  if (typeof actual === 'object' && actual !== null && /^[[{]/.test(text)) {
    try {
      return JSON.parse(text)
    } catch {
      return expected
    }
  }
  return expected
}

export function check(op: AssertOperator, actual: unknown, rawExpected: unknown): boolean {
  const expected = coerceExpected(rawExpected, actual)
  switch (op) {
    case 'eq':
      return deepEqual(actual, expected)
    case 'neq':
      return !deepEqual(actual, expected)
    case 'gt':
      return Number(actual) > Number(expected)
    case 'gte':
      return Number(actual) >= Number(expected)
    case 'lt':
      return Number(actual) < Number(expected)
    case 'lte':
      return Number(actual) <= Number(expected)
    case 'contains':
      return typeof actual === 'string'
        ? actual.includes(String(expected))
        : Array.isArray(actual) && actual.some((item) => deepEqual(item, expected))
    case 'notContains':
      return !check('contains', actual, expected)
    case 'matches':
      return typeof actual === 'string' && new RegExp(String(expected)).test(actual)
    case 'exists':
      return actual !== undefined && actual !== null
    case 'notExists':
      return actual === undefined || actual === null
    case 'isType':
      return typeOf(actual) === String(expected)
    case 'length':
      return (actual as { length?: number } | null)?.length === Number(expected)
  }
}

function show(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

export function describeAssertion(assertion: Assertion): string {
  const unary = UNARY_OPERATORS.includes(assertion.op)
  return `${assertion.expr} ${OPERATOR_LABELS[assertion.op]}${unary ? '' : ` ${typeof assertion.value === 'string' ? assertion.value : show(assertion.value)}`}`
}

export function runAssertions(assertions: Assertion[], scope: ScriptScope): TestResult[] {
  return assertions
    .filter((a) => a.enabled && a.expr.trim())
    .map((assertion) => {
      const name = describeAssertion(assertion)
      let actual: unknown
      try {
        actual = evaluate(assertion.expr, scope)
      } catch (error) {
        return { name, passed: false, error: `Cannot evaluate ${assertion.expr}: ${(error as Error).message}`, kind: 'assertion' as const }
      }
      const passed = check(assertion.op, actual, assertion.value)
      return passed
        ? { name, passed, kind: 'assertion' as const }
        : { name, passed, error: `Actual value: ${show(actual)}`, kind: 'assertion' as const }
    })
}
