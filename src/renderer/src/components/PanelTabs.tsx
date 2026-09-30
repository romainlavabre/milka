// Horizontal tabs of an editor panel, with an optional count per tab.
import clsx from 'clsx'
import type { ReactNode } from 'react'

export interface PanelTab<T extends string> {
  id: T
  label: ReactNode
  /** Number shown next to the label (e.g. enabled headers); hidden when 0. */
  count?: number
  /** Small dot showing the tab has content (scripts, docs). */
  marked?: boolean
}

export function PanelTabs<T extends string>({
  tabs,
  value,
  onChange,
  right
}: {
  tabs: PanelTab<T>[]
  value: T
  onChange: (id: T) => void
  right?: ReactNode
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
      <div role="tablist" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === value}
            className={clsx(
              'relative flex h-9 shrink-0 items-center gap-1 px-2.5 text-xs transition',
              tab.id === value ? 'text-fg after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-accent' : 'text-muted hover:text-fg'
            )}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {!!tab.count && <span className="text-[10px] text-accent">{tab.count}</span>}
            {tab.marked && !tab.count && <span className="size-1.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>
      {right}
    </div>
  )
}
