// Labels of the assertion operators, shared with the renderer.
import type { AssertOperator } from './model'

export const OPERATOR_LABELS: Record<AssertOperator, string> = {
  eq: 'equals',
  neq: 'not equals',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  contains: 'contains',
  notContains: 'not contains',
  matches: 'matches regex',
  exists: 'exists',
  notExists: 'does not exist',
  isType: 'is type',
  length: 'has length'
}

/** Operators that take no expected value. */
export const UNARY_OPERATORS: AssertOperator[] = ['exists', 'notExists']
