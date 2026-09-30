// Data hooks for the workspace registry and its sync status.
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import type { SyncStatus } from '@shared/types'
import { api, onEvent } from '../../lib/bridge'

export function useWorkspace() {
  return useQuery({ queryKey: ['workspace'], queryFn: () => api.workspace.state(), staleTime: Infinity })
}

export function useActiveRepo() {
  const { data } = useWorkspace()
  return data?.repos.find((r) => r.id === data.activeRepoId) ?? null
}

const useStatuses = create<Record<string, SyncStatus>>(() => ({}))

export function useSyncStatus(repoId: string | null | undefined): SyncStatus | null {
  return useStatuses((s) => (repoId ? (s[repoId] ?? null) : null))
}

/** Query keys holding workspace content, refreshed after a pull. */
export const CONTENT_KEYS = [['collections'], ['collection'], ['request'], ['environments']]

/** Subscribes to status events and refreshes the active repo status periodically. */
export function useWorkspaceStatus(): void {
  const queryClient = useQueryClient()
  const { data } = useWorkspace()
  const activeRepoId = data?.activeRepoId

  useEffect(
    () =>
      onEvent('workspace:status', (status) => {
        const previous = useStatuses.getState()[status.repoId]
        useStatuses.setState({ [status.repoId]: status })
        // A pull may have brought new collections or requests.
        if (previous?.syncing && !status.syncing) {
          for (const queryKey of CONTENT_KEYS) void queryClient.invalidateQueries({ queryKey })
        }
      }),
    [queryClient]
  )

  useEffect(
    () =>
      onEvent('workspace:changed', (state) => {
        queryClient.setQueryData(['workspace'], state)
      }),
    [queryClient]
  )

  useEffect(() => {
    if (!activeRepoId) return
    void api.workspace.sync({ repoId: activeRepoId }).catch(() => undefined)
    // Pull the colleagues' changes every 5 minutes.
    const timer = setInterval(() => void api.workspace.sync({ repoId: activeRepoId }).catch(() => undefined), 5 * 60_000)
    return () => clearInterval(timer)
  }, [activeRepoId])
}
