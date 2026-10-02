// Monaco setup: bundled workers (no CDN), themes matching the app, the
// TypeScript defaults used by pre-request / post-response scripts, JSON
// validation left to CodeEditor and the `{{variable}}` completions.
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { openVariableAt } from '@core/varSyntax'

self.MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'html' || label === 'xml') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

monaco.editor.defineTheme('milka-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#16181d',
    'editorGutter.background': '#16181d',
    'editor.lineHighlightBackground': '#1c1f26',
    'editorWidget.background': '#232731'
  }
})

monaco.editor.defineTheme('milka-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#ffffff' }
})

const ts = monaco.typescript
ts.typescriptDefaults.setCompilerOptions({
  target: ts.ScriptTarget.ES2020,
  lib: ['es2022'],
  allowNonTsExtensions: true,
  strict: false,
  noEmit: true,
  // Every script is its own module: top-level names never clash between
  // scripts, and top-level await is allowed.
  moduleDetection: 3,
  module: ts.ModuleKind.ESNext
})
ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false })
ts.typescriptDefaults.setEagerModelSync(true)

// JSON bodies may hold unquoted {{variables}}, which the JSON worker reports as
// errors: CodeEditor checks them with jsonSyntaxError instead.
monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: false })

const extraLibs = new Map<string, monaco.IDisposable>()

/** Declares (or replaces) a global typing file for the script editors. */
export function setScriptTypings(name: string, content: string): void {
  extraLibs.get(name)?.dispose()
  extraLibs.set(name, ts.typescriptDefaults.addExtraLib(content, `file:///typings/${name}.d.ts`))
}

/** A name offered after `{{`, as the variable scope describes it. */
export interface ModelVariable {
  name: string
  detail: string
  preview: string
}

// The names each editor offers after `{{`, by model URI; CodeEditor keeps them current.
const modelVariables = new Map<string, () => ModelVariable[]>()

/** Offers `variables()` after `{{` in the model at `uri`; null stops. */
export function setModelVariables(uri: monaco.Uri, variables: (() => ModelVariable[]) | null): void {
  if (variables) modelVariables.set(uri.toString(), variables)
  else modelVariables.delete(uri.toString())
}

for (const language of ['json', 'xml', 'html', 'plaintext', 'graphql', 'markdown', 'javascript']) {
  monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ['{'],
    provideCompletionItems(model, position) {
      const variables = modelVariables.get(model.uri.toString())
      const open = variables && openVariableAt(model.getValue(), model.getOffsetAt(position))
      if (!variables || !open) return { suggestions: [] }
      const start = model.getPositionAt(open.from)
      const end = model.getPositionAt(open.to)
      const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column)
      return {
        suggestions: variables().map((variable, index) => ({
          label: { label: variable.name, description: variable.detail },
          kind: monaco.languages.CompletionItemKind.Variable,
          detail: variable.detail,
          documentation: variable.preview || undefined,
          insertText: `${variable.name}}}`,
          filterText: variable.name,
          sortText: String(index).padStart(4, '0'),
          range
        }))
      }
    }
  })
}

export { monaco }
