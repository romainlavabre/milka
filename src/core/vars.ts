// `{{variable}}` interpolation.
//
// Names resolve through a lookup chain built by the caller (runtime, request,
// folder, environment, collection variables). A few built-ins are always there:
// `{{process.env.NAME}}`, `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`,
// `{{$randomInt}}`. Unknown names are left as written, so they stand out.
import { randomInt, randomUUID } from 'node:crypto'
import type { KeyValue } from './model'

export type VarMap = Record<string, string>

const PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g
const MAX_DEPTH = 5

export function builtinVariable(name: string, processEnv: Record<string, string | undefined>): string | undefined {
  if (name.startsWith('process.env.')) return processEnv[name.slice('process.env.'.length)]
  switch (name) {
    case '$uuid':
      return randomUUID()
    case '$timestamp':
      return String(Math.floor(Date.now() / 1000))
    case '$isoTimestamp':
      return new Date().toISOString()
    case '$randomInt':
      return String(randomInt(0, 1000))
    default:
      return undefined
  }
}

export class Variables {
  /** Scopes from the highest precedence to the lowest. */
  constructor(
    private readonly scopes: VarMap[],
    private readonly processEnv: Record<string, string | undefined> = {}
  ) {}

  get(name: string): string | undefined {
    for (const scope of this.scopes) if (Object.prototype.hasOwnProperty.call(scope, name)) return scope[name]
    return builtinVariable(name, this.processEnv)
  }

  interpolate(text: string): string {
    let result = text
    for (let depth = 0; depth < MAX_DEPTH && result.includes('{{'); depth++) {
      const next = result.replace(PATTERN, (match, name: string) => this.get(name) ?? match)
      if (next === result) break
      result = next
    }
    return result
  }

  /** Names used in `text` that resolve to nothing. */
  unresolved(text: string): string[] {
    return [...new Set([...this.interpolate(text).matchAll(PATTERN)].map((m) => m[1]))]
  }

  /** Every named variable visible, highest precedence first wins. */
  all(): VarMap {
    const out: VarMap = {}
    for (const scope of [...this.scopes].reverse()) Object.assign(out, scope)
    return out
  }
}

/** Enabled rows of a variable table, as a map. */
export function enabledVars(rows: KeyValue[]): VarMap {
  const out: VarMap = {}
  for (const row of rows) if (row.enabled && row.name) out[row.name] = row.value
  return out
}

/** Every `{{name}}` referenced in `text`. */
export function referencedVariables(text: string): string[] {
  return [...new Set([...text.matchAll(PATTERN)].map((m) => m[1]))]
}
