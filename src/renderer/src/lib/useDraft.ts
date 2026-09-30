// Editing an entity loaded from the workspace: the draft lives in the drafts
// store, so unsaved changes survive switching tabs; Ctrl+S saves.
import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { toast } from '../components/feedback'
import { errorMessage } from './bridge'
import { putDraft, saveDraft, useDrafts } from './drafts'
import { useShortcut } from './shortcuts'

export interface Draft<T> {
  draft: T | null
  setDraft: (update: T | ((draft: T) => T)) => void
  dirty: boolean
  saving: boolean
  save: () => Promise<void>
  error: unknown
}

export function useDraft<T>(options: {
  queryKey: unknown[]
  load: () => Promise<T>
  save: (draft: T) => Promise<void>
  /** Tab the editor belongs to. */
  tabId: string
  /** Editor id, the tab id by default; `<tab id>#…` for an editor inside a tab. */
  id?: string
  /** How the unsaved-changes dialogs name it. */
  describe: (draft: T) => { kind: string; title: string; location: string }
  /** Ctrl+S saves this draft (false for an editor inside another one). */
  shortcut?: boolean
}): Draft<T> {
  const id = options.id ?? options.tabId
  const query = useQuery({ queryKey: options.queryKey, queryFn: options.load, staleTime: Infinity })
  const entry = useDrafts((drafts) => drafts[id])
  const [saving, setSaving] = useState(false)
  // The saved value wins until the user edits: a change from git or the MCP server shows at once.
  const draft = (entry ? entry.value : (query.data ?? null)) as T | null

  const latest = useRef(options)
  latest.current = options
  const savedRef = useRef(query.data)
  savedRef.current = query.data

  const setDraft = useCallback(
    (update: T | ((draft: T) => T)) => {
      const current = (useDrafts.getState()[id]?.value ?? savedRef.current) as T | undefined
      if (current === undefined) return
      const next = typeof update === 'function' ? (update as (draft: T) => T)(current) : update
      const { save, tabId, describe } = latest.current
      putDraft({ id, tabId, ...describe(next), value: next, save: (value) => save(value as T) }, savedRef.current)
    },
    [id]
  )

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await saveDraft(id)
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }, [id])

  useShortcut('s', () => void save(), !!entry && options.shortcut !== false)

  return { draft, setDraft, dirty: !!entry, saving, save, error: query.error }
}
