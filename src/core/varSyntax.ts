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

const BUILTINS = new Set(['$uuid', '$timestamp', '$isoTimestamp', '$randomInt'])

/** Names resolved by Milka itself: `process.env.NAME` and the `$` generators. */
export function isBuiltinVariable(name: string): boolean {
  return name.startsWith('process.env.') || BUILTINS.has(name)
}
