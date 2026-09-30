// Pre-request and post-response scripts, written in TypeScript with
// autocompletion of the `req`, `res`, `milka` and `expect` APIs.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { Scripts } from '@core/model'
import { SCRIPT_TYPINGS, variableTypings } from '@core/script-typings'
import { api } from '../lib/bridge'
import { setScriptTypings } from '../lib/monaco'
import { SegmentedControl } from './ui'
import { CodeEditor } from './CodeEditor'

setScriptTypings('milka', SCRIPT_TYPINGS)

/** Completes milka.vars.get('…') with the variables of the collection. */
function useVariableTypings(collection: string): void {
  const { data } = useQuery({ queryKey: ['variable-names', collection], queryFn: () => api.collections.variableNames({ collection }) })
  useEffect(() => {
    setScriptTypings('variables', variableTypings(data ?? []))
  }, [data])
}

const HINTS = {
  pre: "Runs before the request is sent. Change it through `req`: req.headers['X-Trace'] = milka.uuid()",
  post: 'Runs after the response is received. Read it through `res`, keep values with milka.vars.set(…)'
}

export function ScriptsEditor({
  scripts,
  onChange,
  scope,
  collection
}: {
  scripts: Scripts
  onChange: (scripts: Scripts) => void
  scope: string
  collection: string
}) {
  const [phase, setPhase] = useState<'pre' | 'post'>('pre')
  useVariableTypings(collection)
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-3">
        <SegmentedControl<'pre' | 'post'>
          value={phase}
          onChange={setPhase}
          options={[
            { value: 'pre', label: <>Pre request{scripts.pre.trim() && ' •'}</> },
            { value: 'post', label: <>Post response{scripts.post.trim() && ' •'}</> }
          ]}
        />
        <span className="truncate text-[11px] text-muted">{HINTS[phase]}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <CodeEditor
          key={phase}
          language="typescript"
          modelPath={`file:///scripts/${scope}/${phase}.ts`}
          value={scripts[phase]}
          onChange={(value) => onChange({ ...scripts, [phase]: value })}
        />
      </div>
    </div>
  )
}

export function TestsEditor({
  value,
  onChange,
  scope,
  collection
}: {
  value: string
  onChange: (value: string) => void
  scope: string
  collection: string
}) {
  useVariableTypings(collection)
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <span className="text-[11px] text-muted">
        Runs after the post-response script. test('status is 200', () =&gt; expect(res.status).toBe(200))
      </span>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <CodeEditor language="typescript" modelPath={`file:///scripts/${scope}/tests.ts`} value={value} onChange={onChange} />
      </div>
    </div>
  )
}
