// Data hooks for the collections of the active workspace.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CollectionSummary, TreeNode } from '@core/model'
import { api } from '../../lib/bridge'
import { useWorkspace } from '../workspace/useWorkspace'

export function useCollections() {
  const { data } = useWorkspace()
  return useQuery({
    queryKey: ['collections', data?.activeRepoId],
    queryFn: () => api.collections.list(),
    enabled: !!data?.activeRepoId
  })
}

export function useCollectionSummary(slug: string): CollectionSummary | undefined {
  return useCollections().data?.find((c) => c.slug === slug)
}

export function useRefreshContent(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['collections'] })
    await queryClient.invalidateQueries({ queryKey: ['collection'] })
    await queryClient.invalidateQueries({ queryKey: ['folder'] })
    await queryClient.invalidateQueries({ queryKey: ['environments'] })
  }
}

export function findNode(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.kind === 'folder') {
      const found = findNode(node.children, path)
      if (found) return found
    }
  }
  return undefined
}

export function parentOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

export const METHOD_COLORS: Record<string, string> = {
  GET: '#4cc38a',
  POST: '#f0a33c',
  PUT: '#3b82f6',
  PATCH: '#a78bfa',
  DELETE: '#ef5d5d',
  HEAD: '#8b93a4',
  OPTIONS: '#8b93a4'
}

export function methodColor(method: string): string {
  return METHOD_COLORS[method] ?? '#8b93a4'
}
