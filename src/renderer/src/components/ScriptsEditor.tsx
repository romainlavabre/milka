// Pre-request and post-response scripts, written in TypeScript with
// autocompletion of the `req`, `res`, `milka` and `expect` APIs.
import type { Scripts } from '@core/model'
import { SegmentedControl } from './ui'
import { CodeEditor } from './CodeEditor'
import { useState } from 'react'

const HINTS = {
  pre: "Runs before the request is sent. Change it through `req`: req.headers['X-Trace'] = milka.uuid()",
  post: 'Runs after the response is received. Read it through `res`, keep values with milka.vars.set(…)'
}

export function ScriptsEditor({ scripts, onChange, scope }: { scripts: Scripts; onChange: (scripts: Scripts) => void; scope: string }) {
  const [phase, setPhase] = useState<'pre' | 'post'>('pre')
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

export function TestsEditor({ value, onChange, scope }: { value: string; onChange: (value: string) => void; scope: string }) {
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
