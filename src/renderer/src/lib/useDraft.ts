// Editing an entity loaded from the workspace: local draft, dirty flag,
// Ctrl+S to save.
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../components/feedback'
import { setDirty } from '../store'
import { errorMessage } from './bridge'
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
  tabId: string
}): Draft<T> {
  const query = useQuery({ queryKey: options.queryKey, queryFn: options.load, staleTime: Infinity })
  const [draft, setDraftState] = useState<T | null>(null)
  const [saving, setSaving] = useState(false)
  const baseline = useRef<string | null>(null)

  // Takes the loaded value unless the user has pending edits.
  useEffect(() => {
    if (!query.data) return
    const loaded = JSON.stringify(query.data)
    setDraftState((current) => (current === null || JSON.stringify(current) === baseline.current ? query.data! : current))
    baseline.current = loaded
  }, [query.data])

  const dirty = draft !== null && baseline.current !== null && JSON.stringify(draft) !== baseline.current

  useEffect(() => {
    setDirty(options.tabId, dirty)
  }, [dirty, options.tabId])

  useEffect(() => () => setDirty(options.tabId, false), [options.tabId])

  const setDraft = useCallback((update: T | ((draft: T) => T)) => {
    setDraftState((current) => (current === null ? current : typeof update === 'function' ? (update as (draft: T) => T)(current) : update))
  }, [])

  const saveRef = useRef(options.save)
  saveRef.current = options.save
  const draftRef = useRef(draft)
  draftRef.current = draft

  const save = useCallback(async () => {
    if (!draftRef.current) return
    setSaving(true)
    try {
      await saveRef.current(draftRef.current)
      baseline.current = JSON.stringify(draftRef.current)
      setDirty(options.tabId, false)
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }, [options.tabId])

  useShortcut('s', () => void save(), dirty)

  return { draft, setDraft, dirty, saving, save, error: query.error }
}
