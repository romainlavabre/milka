// Runs a collection or folder with its tests, like `milka run` in CI.
import clsx from 'clsx'
import { CheckCircle2, ChevronRight, CircleDashed, Play, Square, Terminal, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { caseLabel, type RunCase, type RunSummary } from '@core/results'
import { api, errorMessage, onEvent } from '../../lib/bridge'
import { toast } from '../../components/feedback'
import { Button, Checkbox, EmptyState, Input, Spinner } from '../../components/ui'
import { findNode, useCollectionSummary } from '../collections/useCollections'
import { EnvironmentSelect, useSelectedEnvironment } from '../environments/EnvironmentSelect'
import { statusColor } from '../request/ResponsePanel'

export function RunnerView({ collection, path }: { collection: string; path: string }) {
  const summary = useCollectionSummary(collection)
  const env = useSelectedEnvironment(collection)
  const [allBodies, setAllBodies] = useState(true)
  const [bail, setBail] = useState(false)
  const [tags, setTags] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [cases, setCases] = useState<RunCase[]>([])
  const [total, setTotal] = useState(0)
  const [result, setResult] = useState<RunSummary | null>(null)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const runIdRef = useRef<string | null>(null)

  useEffect(
    () =>
      onEvent('runner:case', ({ runId: id, runCase, total: count }) => {
        if (id !== runIdRef.current) return
        setTotal(count)
        setCases((current) => [...current, runCase])
      }),
    []
  )

  const run = async (): Promise<void> => {
    const id = crypto.randomUUID()
    runIdRef.current = id
    setRunId(id)
    setCases([])
    setResult(null)
    setOpen(new Set())
    try {
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      setResult(await api.runner.run({ runId: id, collection, path, env, allBodies, bail, tags: tagList }))
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      runIdRef.current = null
      setRunId(null)
    }
  }

  const target = path ? (findNode(summary?.children ?? [], path)?.name ?? path) : summary?.name
  const cliPath = `collections/${collection}${path ? `/${path}` : ''}`

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Run {target}</div>
          <div className="font-mono text-[11px] text-muted">
            milka run {cliPath}
            {env ? ` --env ${env}` : ''}
            {allBodies ? ' --all-bodies' : ''}
          </div>
        </div>
        <div className="flex-1" />
        <EnvironmentSelect collection={collection} />
        <Checkbox checked={allBodies} onChange={setAllBodies} label="Every body" />
        <Checkbox checked={bail} onChange={setBail} label="Stop at first failure" />
        <Input className="w-36" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags (optional)" />
        {runId ? (
          <Button icon={<Square className="size-3.5" />} onClick={() => void api.runner.cancel({ runId })}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" icon={<Play className="size-3.5" />} onClick={() => void run()}>
            Run
          </Button>
        )}
      </div>
      {(result || runId) && (
        <div className="flex shrink-0 items-center gap-4 border-b border-border px-3 py-2 text-xs">
          {runId && (
            <span className="flex items-center gap-2 text-muted">
              <Spinner className="size-3.5" /> {cases.length}/{total || '…'}
            </span>
          )}
          {result && (
            <>
              <span className={result.failed ? 'font-medium text-danger' : 'font-medium text-success'}>
                {result.failed ? `${result.failed} failed` : 'All passed'}
              </span>
              <span className="text-muted">
                Requests: {result.passed} passed{result.skipped ? `, ${result.skipped} skipped` : ''} · Tests: {result.testsPassed} passed
                {result.testsFailed ? `, ${result.testsFailed} failed` : ''} · {(result.durationMs / 1000).toFixed(2)} s
              </span>
            </>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {cases.length === 0 && !runId && (
          <EmptyState icon={<Terminal className="size-8" />} title="Run the requests and their tests">
            <p className="max-w-md text-xs">
              Requests run in order and share the variables set by their scripts. In CI, the same run is{' '}
              <code className="font-mono">milka run {cliPath}</code>, which exits with an error when a test fails and can write JUnit
              reports.
            </p>
          </EmptyState>
        )}
        {cases.map((runCase, index) => {
          const { result: r } = runCase
          const expanded = open.has(index)
          return (
            <div key={index} className="border-b border-border/50">
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-hover"
                onClick={() => {
                  const next = new Set(open)
                  if (next.has(index)) next.delete(index)
                  else next.add(index)
                  setOpen(next)
                }}
              >
                <ChevronRight className={clsx('size-3.5 text-muted transition', expanded && 'rotate-90')} />
                {r.skipped ? (
                  <CircleDashed className="size-3.5 text-warning" />
                ) : runCase.passed ? (
                  <CheckCircle2 className="size-3.5 text-success" />
                ) : (
                  <XCircle className="size-3.5 text-danger" />
                )}
                <span className="flex-1 truncate">{caseLabel(runCase)}</span>
                {r.response && (
                  <span className="font-mono" style={{ color: statusColor(r.response.status) }}>
                    {r.response.status}
                  </span>
                )}
                {r.tests.length > 0 && (
                  <span className="text-muted">
                    {r.tests.filter((t) => t.passed).length}/{r.tests.length}
                  </span>
                )}
                <span className="w-16 text-right text-muted">{r.durationMs} ms</span>
              </button>
              {expanded && (
                <div className="selectable mb-2 ml-9 space-y-1 font-mono text-[11px]">
                  {r.request && (
                    <div className="text-muted">
                      {r.request.method} {r.request.url}
                    </div>
                  )}
                  {r.skipped && <div className="text-warning">Skipped: {r.skipped}</div>}
                  {r.error && <div className="text-danger">{r.error}</div>}
                  {r.tests.map((test, i) => (
                    <div key={i} className={test.passed ? 'text-success' : 'text-danger'}>
                      {test.passed ? '✓' : '✗'} {test.name}
                      {test.error && <span className="text-muted"> — {test.error}</span>}
                    </div>
                  ))}
                  {r.logs.map((log, i) => (
                    <div key={`log-${i}`} className="text-muted">
                      [{log.source}] {log.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
