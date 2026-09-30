// Response of the last send: status, body, headers, timeline, tests and console.
import clsx from 'clsx'
import { CheckCircle2, Copy, Send, SkipForward, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { succeeded, type ExecutionResult, type Header, type ReceivedResponse } from '@core/results'
import { CodeEditor, type CodeLanguage } from '../../components/CodeEditor'
import { PanelTabs } from '../../components/PanelTabs'
import { toast } from '../../components/feedback'
import { Button, EmptyState, ErrorBox, IconButton, SegmentedControl, Spinner } from '../../components/ui'
import { formatBytes, formatDuration } from '../../lib/format'

type ResponseTab = 'body' | 'headers' | 'timeline' | 'tests' | 'console'

export function statusColor(status: number): string {
  if (status < 300) return 'var(--success)'
  if (status < 400) return '#3b82f6'
  if (status < 500) return 'var(--warning)'
  return 'var(--danger)'
}

function languageOf(contentType: string): CodeLanguage {
  if (/json/i.test(contentType)) return 'json'
  if (/html/i.test(contentType)) return 'html'
  if (/xml/i.test(contentType)) return 'xml'
  if (/javascript/i.test(contentType)) return 'javascript'
  return 'plaintext'
}

export function ResponsePanel({ result, running, onCancel }: { result: ExecutionResult | null; running: boolean; onCancel: () => void }) {
  const [tab, setTab] = useState<ResponseTab>('body')

  if (running) {
    return (
      <EmptyState icon={<Spinner className="size-6" />} title="Sending…">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </EmptyState>
    )
  }
  if (!result) {
    return (
      <EmptyState icon={<Send className="size-8" />} title="No response yet">
        <p className="text-xs">
          Send the request with <kbd className="rounded border border-border px-1">Ctrl</kbd> +{' '}
          <kbd className="rounded border border-border px-1">Enter</kbd>
        </p>
      </EmptyState>
    )
  }

  const response = result.response
  const passed = result.tests.filter((t) => t.passed).length
  const tabs = [
    { id: 'body' as const, label: 'Body' },
    { id: 'headers' as const, label: 'Headers', count: response?.headers.length ?? 0 },
    { id: 'timeline' as const, label: 'Timeline' },
    { id: 'tests' as const, label: result.tests.length ? `Tests ${passed}/${result.tests.length}` : 'Tests' },
    { id: 'console' as const, label: 'Console', count: result.logs.length }
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-3 text-xs">
        {response ? (
          <>
            <span className="font-mono font-bold" style={{ color: statusColor(response.status) }}>
              {response.status} {response.statusText}
            </span>
            <span className="text-muted">{formatDuration(response.timings.total)}</span>
            <span className="text-muted">{formatBytes(response.size)}</span>
          </>
        ) : result.skipped ? (
          <span className="flex items-center gap-1 text-muted">
            <SkipForward className="size-3.5" /> Skipped: {result.skipped}
          </span>
        ) : (
          <span className="font-medium text-danger">Not sent</span>
        )}
        {result.tests.length > 0 && (
          <button
            className={clsx('ml-auto flex items-center gap-1', succeeded(result) ? 'text-success' : 'text-danger')}
            onClick={() => setTab('tests')}
          >
            {succeeded(result) ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
            {passed}/{result.tests.length} passed
          </button>
        )}
      </div>
      {result.error && (
        <div className="shrink-0 p-2">
          <ErrorBox>{result.error}</ErrorBox>
        </div>
      )}
      <PanelTabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="min-h-0 flex-1">
        {tab === 'body' && (response ? <BodyView response={response} /> : <EmptyState title="No response body" />)}
        {tab === 'headers' && <HeadersTable headers={response?.headers ?? []} />}
        {tab === 'timeline' && <Timeline result={result} />}
        {tab === 'tests' && <TestsList result={result} />}
        {tab === 'console' && <Console result={result} />}
      </div>
    </div>
  )
}

function BodyView({ response }: { response: ReceivedResponse }) {
  const [mode, setMode] = useState<'pretty' | 'raw'>('pretty')
  const language = languageOf(response.contentType)
  const pretty = useMemo(() => {
    if (response.encoding !== 'utf8' || language !== 'json') return response.body
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2)
    } catch {
      return response.body
    }
  }, [response, language])

  if (response.encoding === 'base64') {
    if (/^image\//.test(response.contentType)) {
      return (
        <div className="flex h-full items-center justify-center overflow-auto p-4">
          <img alt="Response" src={`data:${response.contentType};base64,${response.body}`} className="max-h-full max-w-full" />
        </div>
      )
    }
    return (
      <EmptyState title="Binary response">
        {formatBytes(response.size)} of {response.contentType || 'unknown type'}
      </EmptyState>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: 'pretty', label: 'Pretty' },
            { value: 'raw', label: 'Raw' }
          ]}
        />
        <div className="flex-1" />
        <IconButton
          label="Copy body"
          onClick={() => {
            void navigator.clipboard.writeText(response.body)
            toast('Response body copied', 'success')
          }}
        >
          <Copy className="size-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor
          readOnly
          wordWrap={mode === 'raw'}
          language={mode === 'pretty' ? language : 'plaintext'}
          value={mode === 'pretty' ? pretty : response.body}
        />
      </div>
    </div>
  )
}

function HeadersTable({ headers }: { headers: Header[] }) {
  if (headers.length === 0) return <EmptyState title="No headers" />
  return (
    <div className="selectable h-full overflow-auto p-3">
      <table className="w-full border-collapse font-mono text-xs">
        <tbody>
          {headers.map(([name, value], i) => (
            <tr key={i} className="border-b border-border/60 align-top">
              <td className="w-1/3 py-1 pr-3 text-muted">{name}</td>
              <td className="break-all py-1">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Timeline({ result }: { result: ExecutionResult }) {
  const { request, response } = result
  if (!request) return <EmptyState title="The request was not sent" />
  return (
    <div className="selectable h-full overflow-auto p-3 font-mono text-xs leading-relaxed">
      <Section title="Request">
        <div className="text-fg">
          {request.method} {request.url}
        </div>
        {request.bodyName && <div className="text-muted">Body variant: {request.bodyName}</div>}
        {request.headers.map(([name, value], i) => (
          <div key={i}>
            <span className="text-muted">{name}:</span> {value}
          </div>
        ))}
        {request.body && <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-panel-2 p-2">{request.body}</pre>}
      </Section>
      {response?.redirects.map((redirect, i) => (
        <Section key={i} title={`Redirect ${redirect.status}`}>
          {redirect.url} → {redirect.location}
        </Section>
      ))}
      {response && (
        <Section title="Response">
          <div style={{ color: statusColor(response.status) }}>
            {response.status} {response.statusText}
          </div>
          <div className="text-muted">
            First byte {formatDuration(response.timings.ttfb)}, complete {formatDuration(response.timings.total)},{' '}
            {formatBytes(response.size)}
          </div>
          {response.headers.map(([name, value], i) => (
            <div key={i}>
              <span className="text-muted">{name}:</span> {value}
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 font-sans text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</div>
      {children}
    </div>
  )
}

function TestsList({ result }: { result: ExecutionResult }) {
  if (result.tests.length === 0) {
    return <EmptyState title="No tests">Add assertions in the Assert tab, or test() calls in the Tests tab.</EmptyState>
  }
  return (
    <div className="selectable h-full overflow-auto p-2">
      {result.tests.map((test, i) => (
        <div key={i} className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-hover">
          {test.passed ? (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
          ) : (
            <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />
          )}
          <div className="min-w-0">
            <div className="text-xs">
              {test.name} <span className="text-[10px] text-muted">{test.kind}</span>
            </div>
            {test.error && <div className="font-mono text-[11px] text-danger">{test.error}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

const LOG_COLORS = { log: 'text-fg', info: 'text-accent', warn: 'text-warning', error: 'text-danger' }

function Console({ result }: { result: ExecutionResult }) {
  if (result.logs.length === 0) return <EmptyState title="Nothing logged">console.log() in scripts prints here.</EmptyState>
  return (
    <div className="selectable h-full overflow-auto p-2 font-mono text-xs">
      {result.logs.map((log, i) => (
        <div key={i} className="flex gap-2 border-b border-border/40 px-1 py-1">
          <span className="w-44 shrink-0 truncate text-muted">{log.source}</span>
          <pre className={clsx('min-w-0 flex-1 whitespace-pre-wrap break-all', LOG_COLORS[log.level])}>{log.message}</pre>
        </div>
      ))}
    </div>
  )
}
