// Small, readable assertion library for tests: expect(value).toBe(…), with `.not`.

export class AssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssertionError'
  }
}

function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  try {
    const json = JSON.stringify(value)
    return json.length > 200 ? `${json.slice(0, 200)}…` : json
  } catch {
    return String(value)
  }
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Structural equality, working across script contexts (no instanceof). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual((a as never)[key], (b as never)[key]))
}

function propertyAt(value: unknown, path: string): { found: boolean; value: unknown } {
  let current = value
  for (const part of path.split('.')) {
    if (current === null || current === undefined || !Object.prototype.hasOwnProperty.call(Object(current), part))
      return { found: false, value: undefined }
    current = (current as Record<string, unknown>)[part]
  }
  return { found: true, value: current }
}

export interface Matchers {
  not: Matchers
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toBeDefined(): void
  toBeUndefined(): void
  toBeNull(): void
  toBeTruthy(): void
  toBeFalsy(): void
  toBeGreaterThan(n: number): void
  toBeGreaterThanOrEqual(n: number): void
  toBeLessThan(n: number): void
  toBeLessThanOrEqual(n: number): void
  toContain(item: unknown): void
  toMatch(pattern: RegExp | string): void
  toHaveLength(length: number): void
  toHaveProperty(path: string, value?: unknown): void
  toBeTypeOf(type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'undefined'): void
  toBeOneOf(values: unknown[]): void
}

export function expect(actual: unknown): Matchers {
  return matchers(actual, false)
}

function matchers(actual: unknown, negated: boolean): Matchers {
  const check = (pass: boolean, description: string): void => {
    if (pass === negated) throw new AssertionError(`Expected ${show(actual)} ${negated ? 'not ' : ''}${description}`)
  }
  return {
    get not() {
      return matchers(actual, !negated)
    },
    toBe: (expected) => check(Object.is(actual, expected), `to be ${show(expected)}`),
    toEqual: (expected) => check(deepEqual(actual, expected), `to equal ${show(expected)}`),
    toBeDefined: () => check(actual !== undefined, 'to be defined'),
    toBeUndefined: () => check(actual === undefined, 'to be undefined'),
    toBeNull: () => check(actual === null, 'to be null'),
    toBeTruthy: () => check(!!actual, 'to be truthy'),
    toBeFalsy: () => check(!actual, 'to be falsy'),
    toBeGreaterThan: (n) => check((actual as number) > n, `to be greater than ${n}`),
    toBeGreaterThanOrEqual: (n) => check((actual as number) >= n, `to be greater than or equal to ${n}`),
    toBeLessThan: (n) => check((actual as number) < n, `to be less than ${n}`),
    toBeLessThanOrEqual: (n) => check((actual as number) <= n, `to be less than or equal to ${n}`),
    toContain: (item) =>
      check(
        typeof actual === 'string' ? actual.includes(String(item)) : Array.isArray(actual) && actual.some((a) => deepEqual(a, item)),
        `to contain ${show(item)}`
      ),
    toMatch: (pattern) => check(typeof actual === 'string' && new RegExp(pattern).test(actual), `to match ${String(pattern)}`),
    toHaveLength: (length) => check((actual as { length?: number } | null)?.length === length, `to have length ${length}`),
    toHaveProperty(path, ...rest) {
      const found = propertyAt(actual, path)
      if (rest.length === 0) check(found.found, `to have property ${path}`)
      else check(found.found && deepEqual(found.value, rest[0]), `to have property ${path} = ${show(rest[0])}`)
    },
    toBeTypeOf: (type) => check(typeOf(actual) === type, `to be of type ${type}`),
    toBeOneOf: (values) =>
      check(
        values.some((v) => deepEqual(v, actual)),
        `to be one of ${show(values)}`
      )
  }
}
