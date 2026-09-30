// Explicit "Sync" button of the active workspace (commit, pull, push), with its
// status and the conflict resolution dialog.
import clsx from 'clsx'
import { AlertTriangle, ArrowDown, ArrowUp, CloudOff, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { ConflictChoice, WorkspaceRepo } from '@shared/types'
import { api } from '../../lib/bridge'
import { relativeTime } from '../../lib/format'
import { Button, Dialog, ErrorBox, SegmentedControl, Tooltip } from '../../components/ui'
import { useSyncStatus } from './useWorkspace'

export function SyncButton({ repo }: { repo: WorkspaceRepo }) {
  const status = useSyncStatus(repo.id)
  const [resolving, setResolving] = useState(false)

  if (status && !status.isGitRepo) return null

  if (status && status.conflicts.length > 0) {
    return (
      <>
        <Button size="sm" className="text-warning" icon={<AlertTriangle className="size-3.5" />} onClick={() => setResolving(true)}>
          Resolve
        </Button>
        <ConflictDialog repo={repo} files={status.conflicts} open={resolving} onOpenChange={setResolving} />
      </>
    )
  }

  const localOnly = status !== null && !status.hasRemote
  let label = 'Commit local changes, pull the remote ones and push'
  if (status?.error) label = `Sync failed: ${status.error}`
  else if (localOnly) label = 'Local only: set a remote in the workspace menu to share'
  else if (status?.lastSyncAt) label = `Synced ${relativeTime(status.lastSyncAt)} — click to sync now`

  return (
    <Tooltip content={<span className="whitespace-pre-wrap">{label}</span>}>
      <Button
        size="sm"
        aria-label="Sync"
        disabled={status?.syncing || localOnly}
        onClick={() => void api.workspace.sync({ repoId: repo.id })}
        className={clsx(status?.error && 'border-danger/60 text-danger')}
        icon={localOnly ? <CloudOff className="size-3.5" /> : <RefreshCw className={clsx('size-3.5', status?.syncing && 'animate-spin')} />}
      >
        Sync
        {status && !status.syncing && status.ahead > 0 && (
          <span className="flex items-center text-[10px] text-accent">
            <ArrowUp className="size-3" />
            {status.ahead}
          </span>
        )}
        {status && !status.syncing && status.behind > 0 && (
          <span className="flex items-center text-[10px] text-accent">
            <ArrowDown className="size-3" />
            {status.behind}
          </span>
        )}
      </Button>
    </Tooltip>
  )
}

function ConflictDialog({
  repo,
  files,
  open,
  onOpenChange
}: {
  repo: WorkspaceRepo
  files: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resolve = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await api.workspace.resolveConflicts({ repoId: repo.id, choices })
    setBusy(false)
    if (result.error) setError(result.error)
    else if (result.conflicts.length === 0) onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Resolve conflicts"
      width={600}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Later</Button>
          <Button variant="primary" loading={busy} disabled={files.some((f) => !choices[f])} onClick={() => void resolve()}>
            Resolve and push
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">
          These files were changed both here and on the remote. Choose which version to keep for each one. Your local version is untouched
          until you resolve.
        </p>
        {files.map((file) => (
          <div key={file} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <span className="truncate font-mono text-xs">{file}</span>
            <SegmentedControl<ConflictChoice | ''>
              value={choices[file] ?? ''}
              onChange={(value) => value && setChoices((c) => ({ ...c, [file]: value }))}
              options={[
                { value: 'mine', label: 'Keep mine' },
                { value: 'theirs', label: 'Keep theirs' }
              ]}
            />
          </div>
        ))}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Dialog>
  )
}
