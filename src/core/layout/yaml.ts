// YAML reading and writing tuned for readable, diff-friendly files.
import { readFileSync, writeFileSync } from 'node:fs'
import { parse, stringify } from 'yaml'

/**
 * Drops what carries no information so files stay short: empty strings,
 * lists and objects, null values and `enabled: true` (the default).
 */
export function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(value)) {
      if (key === 'enabled' && raw === true) continue
      const pruned = prune(raw)
      if (pruned === undefined || pruned === null || pruned === '') continue
      if (Array.isArray(pruned) && pruned.length === 0) continue
      if (pruned && typeof pruned === 'object' && !Array.isArray(pruned) && Object.keys(pruned).length === 0) continue
      out[key] = pruned
    }
    return out
  }
  return value
}

export function toYaml(value: unknown): string {
  // Multi-line strings (bodies, scripts, docs) become literal `|` blocks.
  return stringify(value, { lineWidth: 0, blockQuote: 'literal', aliasDuplicateObjects: false })
}

export function readYaml(file: string): unknown {
  return parse(readFileSync(file, 'utf8')) ?? {}
}

export function writeYaml(file: string, value: unknown): void {
  writeFileSync(file, toYaml(value))
}
