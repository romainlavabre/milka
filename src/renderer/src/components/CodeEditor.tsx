// Monaco editor bound to a string value.
import { useEffect, useRef } from 'react'
import { monaco } from '../lib/monaco'
import { useApp } from '../store'

export type CodeLanguage = 'json' | 'xml' | 'html' | 'plaintext' | 'typescript' | 'graphql' | 'markdown' | 'javascript'

let nextModelId = 1

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  wordWrap = false,
  placeholder,
  modelPath
}: {
  value: string
  onChange?: (value: string) => void
  language: CodeLanguage
  readOnly?: boolean
  wordWrap?: boolean
  placeholder?: string
  /** Model URI, e.g. for scripts: TypeScript needs a `.ts` path. */
  modelPath?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const onChangeRef = useRef(onChange)
  const theme = useApp((s) => s.theme)
  onChangeRef.current = onChange

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
    const subscription = instance.onDidChangeModelContent(() => onChangeRef.current?.(instance.getValue()))
    editor.current = instance
    return () => {
      subscription.dispose()
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
  }, [language])

  useEffect(() => {
    editor.current?.updateOptions({ readOnly, wordWrap: wordWrap ? 'on' : 'off' })
  }, [readOnly, wordWrap])

  useEffect(() => {
    monaco.editor.setTheme(theme === 'light' ? 'milka-light' : 'milka-dark')
  }, [theme])

  return <div ref={container} className="h-full min-h-0 w-full" />
}
