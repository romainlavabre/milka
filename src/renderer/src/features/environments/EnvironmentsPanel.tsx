// Environments of a collection: shared variables committed to the workspace,
// and secret variables whose values stay encrypted on this machine.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Copy, Eye, EyeOff, Globe, Lock, LockOpen, Plus, Save, ShieldAlert, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { newEnvironment, type Environment } from '@core/model'
import type { EnvironmentDraft } from '@shared/types'
import { api, errorMessage } from '../../lib/bridge'
import { useShortcut } from '../../lib/shortcuts'
import { confirm, prompt, toast } from '../../components/feedback'
import { Button, EmptyState, IconButton, Input, Spinner } from '../../components/ui'
import { selectEnvironment, setDirty, tabId } from '../../store'
import { useActiveRepo } from '../workspace/useWorkspace'
import { useEnvironments } from './EnvironmentSelect'

interface Row {
  name: string
  value: string
  enabled: boolean
  secret: boolean
}

function toRows(draft: EnvironmentDraft): Row[] {
  const rows: Row[] = draft.environment.vars.map((v) => ({ name: v.name, value: v.value, enabled: v.enabled, secret: false }))
  for (const name of draft.environment.secrets) rows.push({ name, value: draft.secretValues[name] ?? '', enabled: true, secret: true })
  return rows
}

function fromRows(name: string, rows: Row[]): { data: Environment; secretValues: Record<string, string> } {
  const named = rows.filter((r) => r.name.trim())
  return {
    data: {
      name,
      vars: named.filter((r) => !r.secret).map((r) => ({ name: r.name.trim(), value: r.value, enabled: r.enabled, description: '' })),
      secrets: named.filter((r) => r.secret).map((r) => r.name.trim())
    },
    secretValues: Object.fromEntries(named.filter((r) => r.secret).map((r) => [r.name.trim(), r.value]))
  }
}

export function EnvironmentsPanel({ collection }: { collection: string }) {
  const { data: environments, isLoading } = useEnvironments(collection)
  const [selected, setSelected] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const repo = useActiveRepo()
  const info = useQuery({ queryKey: ['app-info'], queryFn: () => api.app.info(), staleTime: Infinity })

  useEffect(() => {
    if (environments && (!selected || !environments.some((e) => e.slug === selected))) setSelected(environments[0]?.slug ?? null)
  }, [environments, selected])

  const create = async (from?: string): Promise<void> => {
    const name = await prompt({
      title: from ? 'Duplicate environment' : 'New environment',
      label: 'Name',
      initial: from ? '' : 'Development',
      confirmLabel: 'Create'
    })
    if (!name?.trim()) return
    try {
      const base = from
        ? await api.environments.get({ collection, env: from })
        : { environment: newEnvironment(name.trim()), secretValues: {} }
      const slug = await api.environments.save({
        collection,
        env: null,
        data: { ...base.environment, name: name.trim() },
        secretValues: base.secretValues
      })
      await queryClient.invalidateQueries({ queryKey: ['environments', collection] })
      setSelected(slug)
      // The first environment of a collection becomes the selected one.
      if (repo && environments?.length === 0) selectEnvironment(repo.id, collection, slug)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  if (isLoading) return <Spinner className="m-4" />

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-56 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Environments</span>
          <IconButton label="New environment" onClick={() => void create()}>
            <Plus className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-1">
          {environments?.map((env) => (
            <button
              key={env.slug}
              className={clsx(
                'flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-hover',
                env.slug === selected && 'bg-hover text-fg'
              )}
              onClick={() => setSelected(env.slug)}
            >
              <Globe className="size-3.5 text-muted" />
              <span className="truncate">{env.name}</span>
            </button>
          ))}
        </div>
        {info.data && !info.data.secretsEncrypted && (
          <div className="m-2 flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
            <ShieldAlert className="size-4 shrink-0" />
            No system keyring found: secret values are only obfuscated with a local key file.
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {selected ? (
          <EnvironmentEditor
            key={selected}
            collection={collection}
            env={selected}
            onDuplicate={() => void create(selected)}
            onRenamed={setSelected}
          />
        ) : (
          <EmptyState icon={<Globe className="size-8" />} title="No environment">
            <p className="max-w-sm text-xs">
              An environment holds the variables of a target (dev, staging, prod). Mark a variable secret to keep its value encrypted on
              your machine, out of git.
            </p>
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => void create()}>
              New environment
            </Button>
          </EmptyState>
        )}
      </div>
    </div>
  )
}

function EnvironmentEditor({
  collection,
  env,
  onDuplicate,
  onRenamed
}: {
  collection: string
  env: string
  onDuplicate: () => void
  onRenamed: (slug: string) => void
}) {
  const queryClient = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ['environment', collection, env],
    queryFn: () => api.environments.get({ collection, env }),
    staleTime: Infinity
  })
  const [name, setName] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [baseline, setBaseline] = useState('')
  const [saving, setSaving] = useState(false)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const dirtyId = `${tabId('collection', collection)}#environment`

  useEffect(() => {
    if (!data) return
    setName(data.environment.name)
    setRows(toRows(data))
    setBaseline(JSON.stringify([data.environment.name, toRows(data)]))
  }, [data])

  const dirty = !!data && JSON.stringify([name, rows]) !== baseline
  useEffect(() => {
    setDirty(dirtyId, dirty)
  }, [dirty, dirtyId])
  useEffect(() => () => setDirty(dirtyId, false), [dirtyId])

  const save = async (): Promise<void> => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const { data: environment, secretValues } = fromRows(name.trim(), rows)
      const slug = await api.environments.save({ collection, env, data: environment, secretValues })
      setBaseline(JSON.stringify([name, rows]))
      await queryClient.invalidateQueries({ queryKey: ['environments', collection] })
      queryClient.removeQueries({ queryKey: ['environment', collection, env] })
      if (slug !== env) onRenamed(slug)
      toast(`Environment "${environment.name}" saved`, 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  // Saves the environment rather than the collection while it has changes.
  useShortcut('s', () => void save(), dirty)

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      title: `Delete environment "${name}"`,
      body: 'Its variables and the local secret values are deleted.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      await api.environments.remove({ collection, env })
      await queryClient.invalidateQueries({ queryKey: ['environments', collection] })
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  if (error) return <div className="p-3 text-danger">{String(error)}</div>
  if (!data) return <Spinner className="m-4" />

  const update = (index: number, patch: Partial<Row>): void => setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  const cell = 'h-7 w-full bg-transparent px-2 font-mono text-xs outline-none placeholder:text-muted/60 focus:bg-panel-2'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Input aria-label="Environment name" className="max-w-72 font-medium" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex-1" />
        <IconButton label="Duplicate environment" onClick={onDuplicate}>
          <Copy className="size-3.5" />
        </IconButton>
        <IconButton label="Delete environment" onClick={() => void remove()}>
          <Trash2 className="size-3.5" />
        </IconButton>
        <Button
          variant={dirty ? 'primary' : 'secondary'}
          size="sm"
          icon={<Save className="size-3.5" />}
          loading={saving}
          disabled={!dirty}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {data.secretsUnreadable && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
            The secret values saved on this machine cannot be decrypted (the system keyring changed). They are kept in case it comes back;
            type them again to replace them.
          </div>
        )}
        <p className="mb-2 text-[11px] text-muted">
          Use them as <code>{'{{name}}'}</code>. <Lock className="inline size-3" /> Secret values are encrypted on this machine and never
          committed: each teammate types their own. In CI, pass them with <code>--env-var name=value</code> or a{' '}
          <code>MILKA_SECRET_NAME</code> variable.
        </p>
        <div className="selectable overflow-hidden rounded-md border border-border">
          <table className="w-full table-fixed border-collapse">
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="group border-b border-border last:border-b-0">
                  <td className="w-8 border-r border-border text-center">
                    <input
                      type="checkbox"
                      aria-label="Enabled"
                      className="size-3.5 accent-[var(--accent)]"
                      checked={row.enabled}
                      disabled={row.secret}
                      onChange={(e) => update(index, { enabled: e.target.checked })}
                    />
                  </td>
                  <td className="border-r border-border">
                    <input
                      className={cell}
                      value={row.name}
                      placeholder="Variable"
                      onChange={(e) => update(index, { name: e.target.value })}
                    />
                  </td>
                  <td className="border-r border-border">
                    <div className="flex items-center">
                      <input
                        className={cell}
                        type={row.secret && !revealed.has(index) ? 'password' : 'text'}
                        value={row.value}
                        placeholder={row.secret ? 'Secret value (local)' : 'Value'}
                        onChange={(e) => update(index, { value: e.target.value })}
                      />
                      {row.secret && (
                        <IconButton
                          label={revealed.has(index) ? 'Hide' : 'Show'}
                          className="size-6"
                          onClick={() => {
                            const next = new Set(revealed)
                            if (next.has(index)) next.delete(index)
                            else next.add(index)
                            setRevealed(next)
                          }}
                        >
                          {revealed.has(index) ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        </IconButton>
                      )}
                    </div>
                  </td>
                  <td className="w-8 border-r border-border text-center">
                    <IconButton
                      label={row.secret ? 'Secret: value kept on this machine' : 'Shared: value committed'}
                      className={clsx('size-6', row.secret && 'text-accent')}
                      onClick={() => update(index, { secret: !row.secret, enabled: true })}
                    >
                      {row.secret ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
                    </IconButton>
                  </td>
                  <td className="w-8 text-center">
                    <IconButton
                      label="Remove"
                      className="size-6 opacity-0 group-hover:opacity-100"
                      onClick={() => setRows(rows.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="w-8 border-r border-border" />
                <td className="border-r border-border">
                  <input
                    className={cell}
                    value=""
                    placeholder={rows.length ? 'Add…' : 'baseUrl'}
                    onChange={(e) => setRows([...rows, { name: e.target.value, value: '', enabled: true, secret: false }])}
                  />
                </td>
                <td className="border-r border-border" />
                <td className="w-8 border-r border-border" />
                <td className="w-8" />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
