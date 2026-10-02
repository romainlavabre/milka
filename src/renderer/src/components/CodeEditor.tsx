// Monaco editor bound to a string value.
import { useEffect, useRef } from 'react'
import { jsonSyntaxError } from '@core/jsonTemplate'
import { variableTokens } from '@core/varSyntax'
import { monaco, setModelVariables } from '../lib/monaco'
import { useApp } from '../store'
import { useVariableCompletions, useVariableHover, useVariableStatus, type VariableStatus } from './variables'

export type CodeLanguage = 'json' | 'xml' | 'html' | 'plaintext' | 'typescript' | 'graphql' | 'markdown' | 'javascript'

let nextModelId = 1

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  wordWrap = false,
  placeholder,
  modelPath,
  highlightVariables = false
}: {
  value: string
  onChange?: (value: string) => void
  language: CodeLanguage
  readOnly?: boolean
  wordWrap?: boolean
  placeholder?: string
  /** Model URI, e.g. for scripts: TypeScript needs a `.ts` path. */
  modelPath?: string
  /** Colours the `{{variables}}` after the enclosing variable scope, and offers its names after `{{`. */
  highlightVariables?: boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const onChangeRef = useRef(onChange)
  const theme = useApp((s) => s.theme)
  const variables = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const status = useVariableStatus()
  const statusRef = useRef<VariableStatus | null>(null)
  const hovering = useVariableHover()
  const hoverRef = useRef(hovering)
  const completions = useVariableCompletions()
  const completionsRef = useRef(completions)
  const checkJsonRef = useRef(false)
  onChangeRef.current = onChange
  statusRef.current = highlightVariables ? status : null
  hoverRef.current = highlightVariables ? hovering : null
  completionsRef.current = highlightVariables && !readOnly ? completions : null
  // Monaco's JSON validation is off: bodies are checked here, {{variables}} accepted.
  checkJsonRef.current = language === 'json' && !readOnly

  const checkJson = (): void => {
    const model = editor.current?.getModel()
    if (!model) return
    const error = checkJsonRef.current ? jsonSyntaxError(model.getValue()) : null
    monaco.editor.setModelMarkers(
      model,
      'milka-json',
      error
        ? [
            {
              ...monaco.Range.fromPositions(model.getPositionAt(error.start), model.getPositionAt(Math.max(error.end, error.start + 1))),
              severity: monaco.MarkerSeverity.Error,
              message: error.message
            }
          ]
        : []
    )
  }

  const decorate = (): void => {
    const model = editor.current?.getModel()
    const current = statusRef.current
    if (!model || !variables.current) return
    variables.current.set(
      current
        ? variableTokens(model.getValue()).map((token) => {
            const start = model.getPositionAt(token.start)
            const end = model.getPositionAt(token.end)
            return {
              range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
              options: { inlineClassName: `milka-var-${current(token.name)}` }
            }
          })
        : []
    )
  }

  useEffect(() => {
    if (!container.current) return
    const uri = monaco.Uri.parse(modelPath ?? `inmemory://milka/${nextModelId++}.${language === 'typescript' ? 'ts' : 'txt'}`)
    monaco.editor.getModel(uri)?.dispose()
    const model = monaco.editor.createModel(value, language, uri)
    const instance = monaco.editor.create(container.current, {
      model,
      readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
      scrollBeyondLastLine: false,
      wordWrap: wordWrap ? 'on' : 'off',
      tabSize: 2,
      renderLineHighlight: readOnly ? 'none' : 'line',
      lineNumbersMinChars: 3,
      folding: true,
      placeholder,
      fixedOverflowWidgets: true,
      theme: useApp.getState().theme === 'light' ? 'milka-light' : 'milka-dark'
    })
    editor.current = instance
    variables.current = instance.createDecorationsCollection()
    setModelVariables(uri, () => completionsRef.current ?? [])
    decorate()
    checkJson()
    const subscription = instance.onDidChangeModelContent(() => {
      decorate()
      checkJson()
      onChangeRef.current?.(instance.getValue())
    })
    // The variable under the pointer, for the popover of the variable scope.
    let pointed: string | null = null
    const moving = instance.onMouseMove((e) => {
      const hover = hoverRef.current
      const position = e.target.position
      const offset = position && e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT ? model.getOffsetAt(position) : -1
      const token = hover && offset >= 0 ? variableTokens(model.getValue()).find((t) => offset >= t.start && offset < t.end) : undefined
      const key = token ? `${token.start}:${token.name}` : null
      if (key === pointed) return
      pointed = key
      if (!hover) return
      if (!token) return hover.leave()
      const start = model.getPositionAt(token.start)
      const end = model.getPositionAt(token.end)
      const from = instance.getScrolledVisiblePosition(start)
      const to = instance.getScrolledVisiblePosition(end)
      const box = instance.getDomNode()?.getBoundingClientRect()
      if (!from || !to || !box) return
      hover.hover(token.name, new DOMRect(box.left + from.left, box.top + from.top, Math.max(to.left - from.left, 1), from.height))
    })
    const leaving = instance.onMouseLeave(() => {
      if (pointed) hoverRef.current?.leave()
      pointed = null
    })
    return () => {
      subscription.dispose()
      moving.dispose()
      leaving.dispose()
      setModelVariables(uri, null)
      variables.current = null
      instance.dispose()
      model.dispose()
      editor.current = null
    }
    // The editor is created once; value, options and language are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelPath])

  useEffect(() => {
    const instance = editor.current
    if (instance && instance.getValue() !== value) {
      // Keeps undo history and cursor when the value comes from outside.
      const model = instance.getModel()!
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null)
    }
  }, [value])

  useEffect(() => {
    const model = editor.current?.getModel()
    if (model) monaco.editor.setModelLanguage(model, language)
    checkJson()
  }, [language, readOnly])

  useEffect(() => {
    editor.current?.updateOptions({ readOnly, wordWrap: wordWrap ? 'on' : 'off' })
  }, [readOnly, wordWrap])

  useEffect(decorate, [status, highlightVariables])

  useEffect(() => {
    monaco.editor.setTheme(theme === 'light' ? 'milka-light' : 'milka-dark')
  }, [theme])

  return <div ref={container} className="h-full min-h-0 w-full" />
}
