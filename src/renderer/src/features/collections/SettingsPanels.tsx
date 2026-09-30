// Tabs shared by the collection and folder settings: headers, auth,
// variables, scripts, tests and docs.
import type { ReactNode } from 'react'
import type { Auth, KeyValue, Scripts } from '@core/model'
import { AuthEditor } from '../../components/AuthEditor'
import { CodeEditor } from '../../components/CodeEditor'
import { KeyValueTable, keyValue } from '../../components/KeyValueTable'
import { ScriptsEditor, TestsEditor } from '../../components/ScriptsEditor'
import type { PanelTab } from '../../components/PanelTabs'

export type SettingsTab = 'overview' | 'headers' | 'auth' | 'vars' | 'scripts' | 'tests' | 'docs' | 'environments'

export interface Inheritable {
  headers: KeyValue[]
  auth: Auth
  vars: KeyValue[]
  scripts: Scripts
  tests: string
  docs: string
}

export function settingsTabs(value: Inheritable): PanelTab<SettingsTab>[] {
  return [
    { id: 'headers', label: 'Headers', count: value.headers.filter((h) => h.enabled).length },
    { id: 'auth', label: 'Auth', marked: value.auth.type !== 'inherit' && value.auth.type !== 'none' },
    { id: 'vars', label: 'Variables', count: value.vars.filter((v) => v.enabled).length },
    { id: 'scripts', label: 'Scripts', marked: !!(value.scripts.pre.trim() || value.scripts.post.trim()) },
    { id: 'tests', label: 'Tests', marked: !!value.tests.trim() },
    { id: 'docs', label: 'Docs', marked: !!value.docs.trim() }
  ]
}

/** Content of a shared settings tab, or null for the tabs the caller renders itself. */
export function SettingsPanel<T extends Inheritable>({
  tab,
  value,
  onChange,
  scope,
  collection,
  allowInherit
}: {
  tab: SettingsTab
  value: T
  onChange: (value: T) => void
  scope: string
  collection: string
  allowInherit: boolean
}): ReactNode {
  const set = (patch: Partial<Inheritable>): void => onChange({ ...value, ...patch })
  switch (tab) {
    case 'headers':
      return (
        <Padded hint="Sent with every request inside, unless a request sets the same header.">
          <KeyValueTable rows={value.headers} onChange={(headers) => set({ headers })} create={keyValue} namePlaceholder="Header" />
        </Padded>
      )
    case 'auth':
      return (
        <Padded hint="Used by the requests inside whose auth is set to inherit.">
          <AuthEditor auth={value.auth} onChange={(auth) => set({ auth })} allowInherit={allowInherit} />
        </Padded>
      )
    case 'vars':
      return (
        <Padded hint="Available as {{name}} in the requests inside. Environment variables and request variables take precedence.">
          <KeyValueTable rows={value.vars} onChange={(vars) => set({ vars })} create={keyValue} namePlaceholder="Variable" />
        </Padded>
      )
    case 'scripts':
      return (
        <div className="h-full p-3">
          <ScriptsEditor scripts={value.scripts} onChange={(scripts) => set({ scripts })} scope={scope} collection={collection} />
        </div>
      )
    case 'tests':
      return (
        <div className="h-full p-3">
          <TestsEditor value={value.tests} onChange={(tests) => set({ tests })} scope={scope} collection={collection} />
        </div>
      )
    case 'docs':
      return (
        <div className="h-full p-3">
          <div className="h-full overflow-hidden rounded-md border border-border">
            <CodeEditor
              language="markdown"
              wordWrap
              value={value.docs}
              onChange={(docs) => set({ docs })}
              placeholder="Markdown documentation"
            />
          </div>
        </div>
      )
    default:
      return null
  }
}

export function Padded({ hint, children }: { hint?: string; children: ReactNode }) {
  return (
    <div className="h-full overflow-auto p-3">
      {hint && <p className="mb-2 text-[11px] text-muted">{hint}</p>}
      {children}
    </div>
  )
}
