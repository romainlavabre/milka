// Request editor: method and URL bar, request tabs on the left, response on the right.
import { useQueryClient } from '@tanstack/react-query'
import { Save, Send, Square } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useShortcut } from '../../lib/shortcuts'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { HTTP_METHODS, type HttpRequest, type KeyValue, type Param } from '@core/model'
import { applyTypedUrl, displayUrl, syncPathParams } from '@core/url'
import { api } from '../../lib/bridge'
import { useDraft } from '../../lib/useDraft'
import { AuthEditor } from '../../components/AuthEditor'
import { CodeEditor } from '../../components/CodeEditor'
import { KeyValueTable, keyValue } from '../../components/KeyValueTable'
import { PanelTabs } from '../../components/PanelTabs'
import { ScriptsEditor, TestsEditor } from '../../components/ScriptsEditor'
import { Button, Checkbox, ErrorBox, Field, Input, Spinner } from '../../components/ui'
import { retargetTabs, tabId } from '../../store'
import { Padded } from '../collections/SettingsPanels'
import { methodColor, parentOf, useRefreshContent } from '../collections/useCollections'
import { EnvironmentSelect, useSelectedEnvironment } from '../environments/EnvironmentSelect'
import { AssertPanel } from './AssertPanel'
import { BodyPanel } from './BodyPanel'
import { CookiesButton } from './CookiesButton'
import { ResponsePanel } from './ResponsePanel'
import { cancelRequest, sendRequest, useResponse } from './responses'

type RequestTab = 'params' | 'body' | 'headers' | 'auth' | 'vars' | 'scripts' | 'assert' | 'tests' | 'docs' | 'settings'

export function RequestView({ collection, path }: { collection: string; path: string }) {
  const refresh = useRefreshContent()
  const queryClient = useQueryClient()
  const id = tabId('request', collection, path)
  const env = useSelectedEnvironment(collection)
  const response = useResponse(id)
  const [tab, setTab] = useState<RequestTab>('params')

  const { draft, setDraft, dirty, saving, save, error } = useDraft<HttpRequest>({
    queryKey: ['request', collection, path],
    load: () => api.collections.getRequest({ collection, path }),
    tabId: id,
    describe: (request) => ({ kind: 'Request', title: request.name, location: `${collection} / ${path}` }),
    save: async (data) => {
      const saved = await api.collections.saveRequest({ collection, parent: parentOf(path), path, data })
      queryClient.setQueryData(['request', collection, saved], data)
      if (saved !== path) retargetTabs(collection, path, saved)
      await refresh()
    }
  })

  const send = useCallback(() => {
    if (draft) void sendRequest({ tabId: id, collection, path, request: draft, env })
  }, [draft, id, collection, path, env])

  useShortcut('Enter', send)

  if (error) return <ErrorBox>{String(error)}</ErrorBox>
  if (!draft) return <Spinner className="m-4" />

  const set = (patch: Partial<HttpRequest>): void => setDraft({ ...draft, ...patch })
  const enabled = (rows: KeyValue[]): number => rows.filter((r) => r.enabled && r.name).length
  const tabs = [
    { id: 'params' as const, label: 'Params', count: enabled(draft.params) },
    {
      id: 'body' as const,
      label: draft.bodies.length > 1 ? `Bodies` : 'Body',
      count: draft.bodies.length > 1 ? draft.bodies.length : 0,
      marked: draft.bodies.length === 1
    },
    { id: 'headers' as const, label: 'Headers', count: enabled(draft.headers) },
    { id: 'auth' as const, label: 'Auth', marked: draft.auth.type !== 'inherit' },
    { id: 'vars' as const, label: 'Vars', count: enabled(draft.vars.pre) + enabled(draft.vars.post) },
    { id: 'scripts' as const, label: 'Scripts', marked: !!(draft.scripts.pre.trim() || draft.scripts.post.trim()) },
    { id: 'assert' as const, label: 'Assert', count: draft.assertions.filter((a) => a.enabled && a.expr).length },
    { id: 'tests' as const, label: 'Tests', marked: !!draft.tests.trim() },
    { id: 'docs' as const, label: 'Docs', marked: !!draft.docs.trim() },
    { id: 'settings' as const, label: 'Settings' }
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <select
          aria-label="Method"
          className="h-8 rounded-md border border-border bg-bg px-2 font-mono text-xs font-bold outline-none"
          style={{ color: methodColor(draft.method) }}
          value={draft.method}
          onChange={(e) => set({ method: e.target.value })}
        >
          {HTTP_METHODS.map((method) => (
            <option key={method} value={method} style={{ color: methodColor(method) }}>
              {method}
            </option>
          ))}
        </select>
        <Input
          aria-label="URL"
          className="font-mono text-xs"
          value={displayUrl(draft.url, draft.params)}
          placeholder="{{baseUrl}}/users/:id"
          onChange={(e) => set(applyTypedUrl(e.target.value, draft.params))}
        />
        <CookiesButton />
        <EnvironmentSelect collection={collection} />
        {response.running ? (
          <Button variant="secondary" icon={<Square className="size-3.5" />} onClick={() => cancelRequest(id)}>
            Cancel
          </Button>
        ) : (
          <Button variant="primary" icon={<Send className="size-3.5" />} onClick={send} title="Send (Ctrl+Enter)">
            Send
          </Button>
        )}
        <Button icon={<Save className="size-3.5" />} loading={saving} disabled={!dirty} onClick={() => void save()} title="Save (Ctrl+S)">
          Save
        </Button>
      </div>
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel minSize="25">
          <div className="flex h-full min-h-0 flex-col">
            <PanelTabs tabs={tabs} value={tab} onChange={setTab} />
            <div className="min-h-0 flex-1">
              <RequestTabContent
                tab={tab}
                request={draft}
                onChange={setDraft}
                collection={collection}
                scope={`request/${collection}/${path}`}
              />
            </div>
          </div>
        </Panel>
        <Separator className="resize-handle w-px" />
        <Panel minSize="25">
          <ResponsePanel result={response.result} running={response.running} onCancel={() => cancelRequest(id)} />
        </Panel>
      </Group>
    </div>
  )
}

function RequestTabContent({
  tab,
  request,
  onChange,
  collection,
  scope
}: {
  tab: RequestTab
  request: HttpRequest
  onChange: (r: HttpRequest) => void
  collection: string
  scope: string
}) {
  const set = (patch: Partial<HttpRequest>): void => onChange({ ...request, ...patch })
  switch (tab) {
    case 'params': {
      const path = request.params.filter((p) => p.type === 'path')
      const query = request.params.filter((p) => p.type === 'query')
      return (
        <Padded>
          <div className="mb-1 text-[11px] font-medium text-muted">Query parameters</div>
          <KeyValueTable<Param>
            rows={query}
            onChange={(rows) => set({ params: [...path, ...rows] })}
            create={(patch) => ({ ...keyValue(patch), type: 'query' })}
            namePlaceholder="Parameter"
          />
          {path.length > 0 && (
            <>
              <div className="mb-1 mt-4 text-[11px] font-medium text-muted">Path parameters — from the :name segments of the URL</div>
              <KeyValueTable<Param>
                rows={path}
                onChange={(rows) => set({ params: [...syncPathParams(request.url, rows), ...query] })}
                create={(patch) => ({ ...keyValue(patch), type: 'path' })}
                namePlaceholder="Parameter"
                reorderable={false}
              />
            </>
          )}
        </Padded>
      )
    }
    case 'body':
      return <BodyPanel request={request} onChange={onChange} />
    case 'headers':
      return (
        <Padded hint="Headers of the collection and folders are added too; a header set here wins.">
          <KeyValueTable rows={request.headers} onChange={(headers) => set({ headers })} create={keyValue} namePlaceholder="Header" />
        </Padded>
      )
    case 'auth':
      return (
        <Padded>
          <AuthEditor auth={request.auth} onChange={(auth) => set({ auth })} allowInherit />
        </Padded>
      )
    case 'vars':
      return (
        <Padded>
          <div className="mb-1 text-[11px] font-medium text-muted">Before the request — may use other variables</div>
          <KeyValueTable
            rows={request.vars.pre}
            onChange={(pre) => set({ vars: { ...request.vars, pre } })}
            create={keyValue}
            namePlaceholder="Variable"
          />
          <div className="mb-1 mt-4 text-[11px] font-medium text-muted">
            From the response — the value is an expression, kept for the next requests
          </div>
          <KeyValueTable
            rows={request.vars.post}
            onChange={(post) => set({ vars: { ...request.vars, post } })}
            create={keyValue}
            namePlaceholder="Variable"
            valuePlaceholder="res.body.token"
          />
        </Padded>
      )
    case 'scripts':
      return (
        <div className="h-full p-3">
          <ScriptsEditor scripts={request.scripts} onChange={(scripts) => set({ scripts })} scope={scope} collection={collection} />
        </div>
      )
    case 'assert':
      return <AssertPanel assertions={request.assertions} onChange={(assertions) => set({ assertions })} />
    case 'tests':
      return (
        <div className="h-full p-3">
          <TestsEditor value={request.tests} onChange={(tests) => set({ tests })} scope={scope} collection={collection} />
        </div>
      )
    case 'docs':
      return (
        <CodeEditor
          language="markdown"
          wordWrap
          value={request.docs}
          onChange={(docs) => set({ docs })}
          placeholder="Markdown documentation"
        />
      )
    case 'settings':
      return (
        <Padded>
          <div className="flex max-w-md flex-col gap-3">
            <Field label="Timeout (ms)" hint="0 uses the default of 30 seconds.">
              <Input
                type="number"
                min={0}
                value={request.settings.timeout}
                onChange={(e) => set({ settings: { ...request.settings, timeout: Math.max(0, Number(e.target.value) || 0) } })}
              />
            </Field>
            <Checkbox
              checked={request.settings.followRedirects}
              onChange={(followRedirects) => set({ settings: { ...request.settings, followRedirects } })}
              label="Follow redirects"
            />
            <Field label="Maximum redirects">
              <Input
                type="number"
                min={0}
                value={request.settings.maxRedirects}
                onChange={(e) => set({ settings: { ...request.settings, maxRedirects: Math.max(0, Number(e.target.value) || 0) } })}
              />
            </Field>
            <Field label="Tags" hint="Comma separated; `milka run --tags smoke` runs only the tagged requests.">
              <Input
                defaultValue={request.tags.join(', ')}
                placeholder="smoke, users"
                onBlur={(e) =>
                  set({
                    tags: e.target.value
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean)
                  })
                }
              />
            </Field>
          </div>
        </Padded>
      )
  }
}
