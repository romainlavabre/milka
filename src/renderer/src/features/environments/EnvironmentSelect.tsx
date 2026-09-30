// Environment used to send the requests of a collection (remembered per workspace and collection).
import { useQuery } from '@tanstack/react-query'
import { Globe } from 'lucide-react'
import { api } from '../../lib/bridge'
import { selectEnvironment, useApp } from '../../store'
import { useActiveRepo } from '../workspace/useWorkspace'

export function useEnvironments(collection: string) {
  return useQuery({ queryKey: ['environments', collection], queryFn: () => api.environments.list({ collection }) })
}

/** Selected environment of a collection, null when none or when it no longer exists. */
export function useSelectedEnvironment(collection: string): string | null {
  const repo = useActiveRepo()
  const selected = useApp((s) => (repo ? (s.environments[`${repo.id}:${collection}`] ?? null) : null))
  const { data } = useEnvironments(collection)
  if (!selected || !data?.some((e) => e.slug === selected)) return null
  return selected
}

export function EnvironmentSelect({ collection }: { collection: string }) {
  const repo = useActiveRepo()
  const { data } = useEnvironments(collection)
  const selected = useSelectedEnvironment(collection)
  if (!repo) return null
  return (
    <label className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-bg px-2 text-xs" title="Environment">
      <Globe className="size-3.5 text-muted" />
      <select
        aria-label="Environment"
        className="max-w-40 bg-transparent outline-none"
        value={selected ?? ''}
        onChange={(e) => selectEnvironment(repo.id, collection, e.target.value || null)}
      >
        <option value="">No environment</option>
        {data?.map((env) => (
          <option key={env.slug} value={env.slug}>
            {env.name}
          </option>
        ))}
      </select>
    </label>
  )
}
