// Unsaved changes before quitting, closing a tab or switching workspace: a
// popup to save or drop them all, and a dialog to choose file by file.
import clsx from 'clsx'
import { FileWarning } from 'lucide-react'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { api, errorMessage, onEvent } from '../../lib/bridge'
import { allDrafts, draftsOfTab, forgetDraft, saveDraft, type DraftEntry } from '../../lib/drafts'
import { closeTab, useApp } from '../../store'
import { toast } from '../../components/feedback'
import { Button, Dialog } from '../../components/ui'

/** What happens once the changes are dealt with, e.g. "Quit". */
interface Ask {
  entries: DraftEntry[]
  proceed: string
  resolve: (proceed: boolean) => void
}

const useAsk = create<{ ask: Ask | null; choosing: boolean }>(() => ({ ask: null, choosing: false }))

/**
 * Asks what to do with unsaved changes; resolves true once they are saved or
 * dropped as chosen, false when the user cancels. Resolves true at once without changes.
 */
export function askUnsaved(entries: DraftEntry[], proceed: string): Promise<boolean> {
  if (entries.length === 0) return Promise.resolve(true)
  // A question already open is answered "cancel" by a new one.
  useAsk.getState().ask?.resolve(false)
  return new Promise((resolve) => useAsk.setState({ ask: { entries, proceed, resolve }, choosing: false }))
}

/** Closes a tab, asking first when it has unsaved changes. */
export async function closeTabSafely(id: string): Promise<void> {
  if (await askUnsaved(draftsOfTab(id), 'Close')) closeTab(id)
}

/** Unsaved changes of the tabs of a collection, or of a node and below: before moving or renaming them. */
export function draftsUnder(collection: string, path?: string): DraftEntry[] {
  return useApp
    .getState()
    .tabs.filter((tab) => tab.collection === collection && (path === undefined || tab.path === path || tab.path.startsWith(`${path}/`)))
    .flatMap((tab) => draftsOfTab(tab.id))
}

/** Saves the chosen drafts and drops the others; false when a save failed (the failed ones stay). */
async function apply(entries: DraftEntry[], keep: Set<string>): Promise<boolean> {
  let ok = true
  for (const entry of entries) {
    if (!keep.has(entry.id)) {
      forgetDraft(entry.id)
      continue
    }
    try {
      await saveDraft(entry.id)
    } catch (error) {
      ok = false
      toast(`${entry.kind} "${entry.title}": ${errorMessage(error)}`, 'error')
    }
  }
  return ok
}

function finish(proceed: boolean): void {
  useAsk.getState().ask?.resolve(proceed)
  useAsk.setState({ ask: null, choosing: false })
}

/** Mounted once: answers the main process when the window is about to close. */
export function UnsavedChanges() {
  const { ask, choosing } = useAsk()
  const [busy, setBusy] = useState(false)

  useEffect(
    () =>
      onEvent('app:close-requested', () => {
        void askUnsaved(allDrafts(), 'Quit').then((proceed) => {
          if (proceed) void api.app.close()
        })
      }),
    []
  )

  if (!ask) return null
  const count = ask.entries.length

  const run = async (keep: Set<string>): Promise<void> => {
    setBusy(true)
    const ok = await apply(ask.entries, keep)
    setBusy(false)
    if (ok) finish(true)
    // Only the drafts that could not be saved are left to decide on.
    else useAsk.setState({ ask: { ...ask, entries: ask.entries.filter((e) => keep.has(e.id) && allDrafts().some((d) => d.id === e.id)) } })
  }

  if (choosing) return <ChooseDialog ask={ask} busy={busy} onApply={(keep) => void run(keep)} />

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && finish(false)}
      title="Unsaved changes"
      width={480}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={() => finish(false)}>
            Cancel
          </Button>
          <div className="flex-1" />
          <Button disabled={busy} onClick={() => useAsk.setState({ choosing: true })}>
            Choose…
          </Button>
          <Button disabled={busy} onClick={() => void run(new Set())}>
            Don't save
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void run(new Set(ask.entries.map((e) => e.id)))}>
            Save all
          </Button>
        </>
      }
    >
      <div className="flex gap-3 text-xs">
        <FileWarning className="size-5 shrink-0 text-warning" />
        <div className="min-w-0 space-y-2">
          <p>
            {count === 1 ? '1 file has' : `${count} files have`} unsaved changes. Save them before you {ask.proceed.toLowerCase()}?
          </p>
          <ul className="space-y-0.5 text-muted">
            {ask.entries.slice(0, 5).map((entry) => (
              <li key={entry.id} className="truncate">
                {entry.kind} <span className="text-fg">{entry.title}</span>
              </li>
            ))}
            {count > 5 && <li>and {count - 5} more</li>}
          </ul>
        </div>
      </div>
    </Dialog>
  )
}

function ChooseDialog({ ask, busy, onApply }: { ask: Ask; busy: boolean; onApply: (keep: Set<string>) => void }) {
  const [keep, setKeep] = useState(() => new Set(ask.entries.map((e) => e.id)))
  const toggle = (id: string, save: boolean): void => {
    const next = new Set(keep)
    if (save) next.add(id)
    else next.delete(id)
    setKeep(next)
  }
  const saved = ask.entries.filter((e) => keep.has(e.id)).length

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && useAsk.setState({ choosing: false })}
      title="Choose the changes to save"
      width={620}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={() => useAsk.setState({ choosing: false })}>
            Back
          </Button>
          <div className="flex-1" />
          <Button variant="primary" loading={busy} onClick={() => onApply(keep)}>
            {saved === ask.entries.length ? `Save all and ${ask.proceed.toLowerCase()}` : `Apply and ${ask.proceed.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <div>
        <p className="mb-3 text-[11px] text-muted">Each file is saved as a whole, or its changes are discarded.</p>
        <ul className="divide-y divide-border rounded-md border border-border">
          {ask.entries.map((entry) => {
            const save = keep.has(entry.id)
            return (
              <li key={entry.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    <span className="text-muted">{entry.kind}</span> <span className="font-medium">{entry.title}</span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted">{entry.location}</div>
                </div>
                <div
                  className="flex shrink-0 rounded-md border border-border p-0.5"
                  role="radiogroup"
                  aria-label={`${entry.kind} ${entry.title}`}
                >
                  {[
                    { label: 'Save', value: true },
                    { label: 'Discard', value: false }
                  ].map((option) => (
                    <button
                      key={option.label}
                      role="radio"
                      aria-checked={save === option.value}
                      className={clsx(
                        'rounded px-2.5 py-1 text-[11px]',
                        save === option.value
                          ? option.value
                            ? 'bg-accent text-accent-fg'
                            : 'bg-danger text-white'
                          : 'text-muted hover:bg-hover'
                      )}
                      onClick={() => toggle(entry.id, option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </Dialog>
  )
}
