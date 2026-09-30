// `{{variable}}` colouring: green when the variable resolves for the edited
// request and the selected environment, red when it does not (as in Bruno).
import { useQuery } from '@tanstack/react-query'
import { createContext, forwardRef, useCallback, useContext, useLayoutEffect, useMemo, useRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { isBuiltinVariable, variableTokens } from '@core/varSyntax'
import { api } from '../lib/bridge'
import { useSelectedEnvironment } from '../features/environments/EnvironmentSelect'
import { cn, fieldClass } from './ui'

export type VariableStatus = (name: string) => 'defined' | 'undefined'

const VariableScope = createContext<VariableStatus | null>(null)

/** Query key of the visible variables; under `environments` so that saving an environment refreshes them. */
export function visibleVariablesKey(collection: string): unknown[] {
  return ['environments', collection, 'visible-variables']
}

/**
 * Tells the editors inside which variables resolve for a request of `folder`
 * ('' for the root). `extra` are the names defined by the unsaved draft.
 */
export function VariableScopeProvider({
  collection,
  folder,
  extra = [],
  children
}: {
  collection: string
  folder: string
  extra?: string[]
  children: ReactNode
}) {
  const env = useSelectedEnvironment(collection)
  const { data } = useQuery({
    queryKey: [...visibleVariablesKey(collection), folder, env],
    queryFn: () => api.collections.visibleVariables({ collection, folder, env })
  })
  const extraKey = extra.join('\n')
  const status = useMemo<VariableStatus | null>(() => {
    if (!data) return null
    const names = new Set([...data, ...extraKey.split('\n').filter(Boolean)])
    return (name) => (names.has(name) || isBuiltinVariable(name) ? 'defined' : 'undefined')
  }, [data, extraKey])
  return <VariableScope.Provider value={status}>{children}</VariableScope.Provider>
}

/** Status of a variable name; null outside a scope, where nothing is coloured. */
export function useVariableStatus(): VariableStatus | null {
  return useContext(VariableScope)
}

/** Names of the enabled rows of variable tables. */
export function definedNames(...tables: { name: string; enabled: boolean }[][]): string[] {
  return tables.flatMap((rows) => rows.filter((row) => row.enabled && row.name).map((row) => row.name))
}

const COLORS = { defined: 'text-success', undefined: 'text-danger' }

/**
 * An input whose `{{variables}}` are coloured: the text is drawn by a mirror
 * laid over a transparent-text input, which keeps the caret and the selection.
 * `bare` drops the field styling (table cells pass their own classes).
 */
export const VariableInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { bare?: boolean }>(
  function VariableInput({ bare = false, className, onScroll, onSelect, title, ...props }, ref) {
    const status = useVariableStatus()
    const value = String(props.value ?? '')
    const tokens = status && value.includes('{{') ? variableTokens(value) : []
    const mirrored = tokens.length > 0
    const classes = bare ? className : cn(fieldClass, 'h-8', className)
    const input = useRef<HTMLInputElement | null>(null)
    const text = useRef<HTMLSpanElement>(null)

    const sync = useCallback(() => {
      if (text.current && input.current) text.current.style.transform = `translateX(${-input.current.scrollLeft}px)`
    }, [])
    useLayoutEffect(sync, [sync, value, mirrored])

    const setRef = (node: HTMLInputElement | null): void => {
      input.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    }

    const segments: ReactNode[] = []
    let at = 0
    for (const token of tokens) {
      if (token.start > at) segments.push(value.slice(at, token.start))
      segments.push(
        <span key={token.start} className={COLORS[status!(token.name)]}>
          {value.slice(token.start, token.end)}
        </span>
      )
      at = token.end
    }
    if (at < value.length) segments.push(value.slice(at))

    const unknown = tokens.filter((t) => status!(t.name) === 'undefined').map((t) => t.name)

    return (
      <div className="relative w-full min-w-0">
        <input
          ref={setRef}
          spellCheck={false}
          {...props}
          title={title ?? (unknown.length ? `Undefined: ${[...new Set(unknown)].join(', ')}` : undefined)}
          className={cn(classes, mirrored && 'text-transparent [caret-color:var(--fg)]')}
          onScroll={(e) => {
            sync()
            onScroll?.(e)
          }}
          onSelect={(e) => {
            sync()
            onSelect?.(e)
          }}
        />
        {mirrored && (
          <div
            aria-hidden
            className={cn(classes, 'pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre border-transparent bg-transparent')}
          >
            <span ref={text}>{segments}</span>
          </div>
        )}
      </div>
    )
  }
)
