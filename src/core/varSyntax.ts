// `{{variable}}` syntax, without the resolution: shared by the interpolation
// and by the editors that colour the variables.

/** A `{{name}}` reference; the name may be padded with spaces. */
export const VARIABLE_PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g

export interface VariableToken {
  start: number
  end: number
  name: string
}

/** Every `{{name}}` of `text`, in order. */
export function variableTokens(text: string): VariableToken[] {
  return [...text.matchAll(VARIABLE_PATTERN)].map((m) => ({ start: m.index, end: m.index + m[0].length, name: m[1] }))
}

/** The `$` generators, resolved by Milka on each send. */
export const BUILTIN_VARIABLES = ['$uuid', '$timestamp', '$isoTimestamp', '$randomInt']

const BUILTINS = new Set(BUILTIN_VARIABLES)

/** Names resolved by Milka itself: `process.env.NAME` and the `$` generators. */
export function isBuiltinVariable(name: string): boolean {
  return name.startsWith('process.env.') || BUILTINS.has(name)
}

/** A `{{` being typed: the name goes in `from`..`to`, `query` is what was typed before the caret. */
export interface OpenVariable {
  from: number
  to: number
  query: string
}

const NAME_CHAR = /[^{}\s]/
/** After the caret, stricter: `{{bas/users` must keep `/users`. */
const WORD_CHAR = /[\w.$-]/

/**
 * The `{{` the caret is in, still being typed: only name characters between it
 * and the caret. The range runs over the word characters after the caret and
 * over a `}}` already there (an editor that closes the braces by itself).
 */
export function openVariableAt(text: string, caret: number): OpenVariable | null {
  let from = caret
  while (from > 0 && NAME_CHAR.test(text[from - 1])) from--
  if (from < 2 || text.slice(from - 2, from) !== '{{' || text[from - 3] === '{') return null
  let to = caret
  while (to < text.length && WORD_CHAR.test(text[to])) to++
  if (text.startsWith('}}', to)) to += 2
  return { from, to, query: text.slice(from, caret) }
}

/** `text` with the open variable completed as `{{name}}`, and the caret after it. */
export function insertVariable(text: string, open: OpenVariable, name: string): { text: string; caret: number } {
  const inserted = `${name}}}`
  return { text: text.slice(0, open.from) + inserted + text.slice(open.to), caret: open.from + inserted.length }
}

/** The names matching `query`: those it starts first, then those it is inside, case ignored; order kept otherwise. */
export function filterCompletions<T extends { name: string }>(items: T[], query: string): T[] {
  const q = query.toLowerCase()
  const starts = items.filter((item) => item.name.toLowerCase().startsWith(q))
  const inside = items.filter((item) => !item.name.toLowerCase().startsWith(q) && item.name.toLowerCase().includes(q))
  return [...starts, ...inside]
}
