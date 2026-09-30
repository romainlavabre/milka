// Environment used to send the requests of a collection (remembered per workspace and collection).
import * as Menu from '@radix-ui/react-dropdown-menu'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, ChevronDown, Globe, Settings2 } from 'lucide-react'
import { api } from '../../lib/bridge'
import { openTab, selectEnvironment, useApp } from '../../store'
import { menuContentClass, menuItemClass } from '../workspace/WorkspaceSwitcher'
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
  const current = data?.find((env) => env.slug === selected)

  const item = (slug: string | null, label: string) => (
    <Menu.Item key={slug ?? ''} className={menuItemClass} onSelect={() => selectEnvironment(repo.id, collection, slug)}>
      <Check className={clsx('size-3.5 shrink-0', slug === selected ? 'text-accent' : 'opacity-0')} />
      <span className={clsx('min-w-0 flex-1 truncate', !slug && 'text-muted')}>{label}</span>
    </Menu.Item>
  )

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Environment"
        title="Environment"
        className="flex h-8 max-w-48 shrink-0 items-center gap-1.5 rounded-md border border-border bg-bg px-2 text-xs outline-none hover:bg-hover focus-visible:border-accent data-[state=open]:bg-hover"
      >
        <Globe className={clsx('size-3.5 shrink-0', current ? 'text-accent' : 'text-muted')} />
        <span className={clsx('min-w-0 flex-1 truncate', !current && 'text-muted')}>{current?.name ?? 'No environment'}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className={clsx(menuContentClass, 'max-h-80 overflow-y-auto')}>
          <Menu.Label className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Environment</Menu.Label>
          {item(null, 'No environment')}
          {data?.map((env) => item(env.slug, env.name))}
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item className={menuItemClass} onSelect={() => openTab('collection', collection)}>
            <Settings2 className="size-3.5 shrink-0" /> Manage environments…
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
