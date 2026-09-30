// `{{variable}}` colouring: green when the variable resolves for the edited
// request and the selected environment, red when it does not. Hovering one
// shows its value and where it comes from, and lets you set it (as in Bruno).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import type { KeyValue } from '@core/model'
import { isBuiltinVariable, variableTokens } from '@core/varSyntax'
import type { VariableSource, VariableTarget, VisibleVariable } from '@shared/types'
import { api, errorMessage } from '../lib/bridge'
import { useDrafts } from '../lib/drafts'
import { tabId } from '../store'
import { useEnvironments, useSelectedEnvironment } from '../features/environments/EnvironmentSelect'
import { toast } from './feedback'
import { Button, cn, fieldClass, IconButton } from './ui'

export type VariableStatus = (name: string) => 'defined' | 'undefined'

/** Variables defined by the entity being edited, unsaved changes included. */
export interface LocalVariables {
  /** How the popover names this scope, e.g. "this request". */
  label: string
  rows: { name: string; value: string; enabled: boolean }[]
  set(name: string, value: string): void
}

interface Scope {
  status: VariableStatus
  /** The pointer is over `{{name}}`, drawn in `rect`. */
  hover(name: string, rect: DOMRect): void
  /** The pointer left the variable. */
  leave(): void
}

const VariableScope = createContext<Scope | null>(null)

/** Query key of the visible variables; under `environments` so that saving an environment refreshes them. */
export function visibleVariablesKey(collection: string): unknown[] {
  return ['environments', collection, 'visible-variables']
}

type Resolved =
  | { kind: 'visible'; variable: VisibleVariable }
  | { kind: 'local'; value: string }
  | { kind: 'response' }
  | { kind: 'builtin' }
  | { kind: 'undefined' }

/**
 * Tells the editors inside which variables resolve for a request of `folder`
 * ('' for the root). `local` are the variables of the edited entity, `extra`
 * names set later (post-response variables).
 */
export function VariableScopeProvider({
  collection,
  folder,
  local,
  extra = [],
  children
}: {
  collection: string
  folder: string
  local?: LocalVariables
  extra?: string[]
  children: ReactNode
}) {
  const env = useSelectedEnvironment(collection)
  const { data } = useQuery({
    queryKey: [...visibleVariablesKey(collection), folder, env],
    queryFn: () => api.collections.visibleVariables({ collection, folder, env })
  })
  const localRef = useRef(local)
  localRef.current = local
  const localKey = JSON.stringify(local?.rows.filter((r) => r.enabled && r.name).map((r) => [r.name, r.value]) ?? [])
  const extraKey = extra.join('\n')

  // Same order as the engine: runtime, then the edited entity, then the other scopes.
  const resolve = useMemo<((name: string) => Resolved) | null>(() => {
    if (!data) return null
    const visible = new Map(data.map((v) => [v.name, v]))
    const locals = new Map(JSON.parse(localKey) as [string, string][])
    const later = new Set(extraKey.split('\n').filter(Boolean))
    return (name) => {
      const found = visible.get(name)
      if (found?.source.kind === 'runtime') return { kind: 'visible', variable: found }
      if (locals.has(name)) return { kind: 'local', value: locals.get(name)! }
      if (found && found.value !== null) return { kind: 'visible', variable: found }
      if (later.has(name)) return { kind: 'response' }
      if (isBuiltinVariable(name)) return { kind: 'builtin' }
      if (found) return { kind: 'visible', variable: found }
      return { kind: 'undefined' }
    }
  }, [data, localKey, extraKey])

  const [hovered, setHovered] = useState<{ name: string; rect: DOMRect } | null>(null)
  const [pinned, setPinned] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pinnedRef = useRef(false)
  pinnedRef.current = pinned
  const shownRef = useRef<string | null>(null)
  shownRef.current = hovered?.name ?? null

  const close = useCallback(() => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
    setHovered(null)
    setPinned(false)
  }, [])
  const keepOpen = useCallback(() => clearTimeout(closeTimer.current), [])
  const leave = useCallback(() => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
    if (!pinnedRef.current) closeTimer.current = setTimeout(() => setHovered(null), 250)
  }, [])
  const hover = useCallback((name: string, rect: DOMRect) => {
    clearTimeout(closeTimer.current)
    clearTimeout(openTimer.current)
    if (pinnedRef.current) return
    // Another variable while a popover is shown: follow at once.
    if (shownRef.current !== null) setHovered({ name, rect })
    else openTimer.current = setTimeout(() => setHovered({ name, rect }), 350)
  }, [])
  useEffect(() => () => close(), [close])

  const scope = useMemo<Scope | null>(
    () =>
      resolve && {
        status: (name) => {
          const resolved = resolve(name)
          return resolved.kind === 'undefined' || (resolved.kind === 'visible' && resolved.variable.value === null) ? 'undefined' : 'defined'
        },
        hover,
        leave
      },
    [resolve, hover, leave]
  )

  return (
    <VariableScope.Provider value={scope}>
      {children}
      {hovered &&
        resolve &&
        createPortal(
          <VariablePopover
            key={hovered.name}
            collection={collection}
            env={env}
            name={hovered.name}
            rect={hovered.rect}
            resolved={resolve(hovered.name)}
            local={localRef.current}
            onEnter={keepOpen}
            onLeave={leave}
            onEditing={setPinned}
            onClose={close}
          />,
          document.body
        )}
    </VariableScope.Provider>
  )
}

/** Status of a variable name; null outside a scope, where nothing is coloured. */
export function useVariableStatus(): VariableStatus | null {
  return useContext(VariableScope)?.status ?? null
}

/** Reports the variable under the pointer; null outside a scope. */
export function useVariableHover(): Pick<Scope, 'hover' | 'leave'> | null {
  return useContext(VariableScope)
}

// ------------------------------------------------------------------ popover

/** Draft id of the editor of a scope, which a direct write would overwrite. */
function draftOf(collection: string, target: VariableTarget): string {
  if (target.kind === 'collection') return tabId('collection', collection)
  if (target.kind === 'folder') return tabId('folder', collection, target.path)
  return `${tabId('collection', collection)}#environment:${target.env}`
}

function VariablePopover({
  collection,
  env,
  name,
  rect,
  resolved,
  local,
  onEnter,
  onLeave,
  onEditing,
  onClose
}: {
  collection: string
  env: string | null
  name: string
  rect: DOMRect
  resolved: Resolved
  local?: LocalVariables
  onEnter(): void
  onLeave(): void
  onEditing(editing: boolean): void
  onClose(): void
}) {
  const queryClient = useQueryClient()
  const { data: environments } = useEnvironments(collection)
  const envName = (slug: string): string => environments?.find((e) => e.slug === slug)?.name ?? slug
  const box = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: rect.bottom + 4, left: rect.left })

  // Where the value comes from, and where a new value is written.
  // An undefined variable goes to the selected environment, else to the edited entity, else to the collection.
  const variable = resolved.kind === 'visible' ? resolved.variable : null
  const target: VariableSource | 'local' | null =
    resolved.kind === 'visible'
      ? resolved.variable.source
      : resolved.kind === 'local'
        ? 'local'
        : resolved.kind !== 'undefined'
          ? null
          : env
            ? { kind: 'environment', env }
            : local
              ? 'local'
              : { kind: 'collection' }
  const current = variable ? (variable.value ?? '') : resolved.kind === 'local' ? resolved.value : ''
  const secret = variable?.secret ?? false
  const [value, setValue] = useState(current)
  const [revealed, setRevealed] = useState(!secret)
  const [saving, setSaving] = useState(false)
  const dirty = value !== current

  useEffect(() => onEditing(dirty), [dirty, onEditing])

  useLayoutEffect(() => {
    const width = box.current?.offsetWidth ?? 320
    const height = box.current?.offsetHeight ?? 120
    const below = rect.bottom + 4 + height < window.innerHeight
    setPosition({
      top: below ? rect.bottom + 4 : Math.max(4, rect.top - 4 - height),
      left: Math.max(4, Math.min(rect.left, window.innerWidth - width - 4))
    })
  }, [rect])

  // A click elsewhere closes it, unsaved typing included.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const describe = (source: VariableSource | 'local'): string => {
    if (source === 'local') return local?.label ?? 'this editor'
    switch (source.kind) {
      case 'runtime':
        return 'runtime (set by a script, until Milka quits)'
      case 'collection':
        return 'collection'
      case 'folder':
        return `folder ${source.path}`
      case 'environment':
        return `${secret ? 'secret of ' : ''}environment ${envName(source.env)}`
    }
  }

  const save = async (): Promise<void> => {
    if (!target) return
    setSaving(true)
    try {
      if (target === 'local') local?.set(name, value)
      else if (target.kind === 'runtime') await api.http.setRuntimeVar({ name, value })
      else {
        if (useDrafts.getState()[draftOf(collection, target)])
          throw new Error(`The ${describe(target)} has unsaved changes: save or discard them first`)
        await api.collections.setVariable({ collection, target, name, value })
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['collection', collection] }),
          queryClient.invalidateQueries({ queryKey: ['folder', collection] }),
          queryClient.invalidateQueries({ queryKey: ['environment', collection] })
        ])
      }
      await queryClient.invalidateQueries({ queryKey: visibleVariablesKey(collection) })
      onClose()
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  let body: ReactNode
  if (resolved.kind === 'builtin')
    body = (
      <p className="text-muted">
        {name.startsWith('process.env.') ? 'Read from the environment Milka runs in.' : 'Generated by Milka on each send.'}
      </p>
    )
  else if (resolved.kind === 'response') body = <p className="text-muted">Set from the response, by a post-response variable of this request.</p>
  else
    body = (
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="flex items-center gap-1">
          <input
            autoFocus={resolved.kind === 'undefined'}
            aria-label={`Value of ${name}`}
            type={revealed ? 'text' : 'password'}
            className={cn(fieldClass, 'h-7 font-mono text-xs')}
            value={value}
            placeholder={variable?.value === null ? 'No value typed on this computer' : 'Value'}
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
          />
          {secret && (
            <IconButton label={revealed ? 'Hide' : 'Show'} type="button" onClick={() => setRevealed(!revealed)}>
              {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </IconButton>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-[11px] text-muted">
            {resolved.kind === 'undefined' ? `Not defined: saved in ${describe(target!)}` : `From ${describe(target!)}`}
          </span>
          <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!dirty && resolved.kind !== 'undefined'}>
            Save
          </Button>
        </div>
      </form>
    )

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`Variable ${name}`}
      className="fixed z-50 flex w-80 flex-col gap-2 rounded-md border border-border bg-panel-2 p-2.5 text-xs text-fg shadow-lg"
      style={position}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className={cn('font-mono font-semibold', resolved.kind === 'undefined' || variable?.value === null ? 'text-danger' : 'text-success')}>
        {`{{${name}}}`}
      </div>
      {body}
    </div>
  )
}

// -------------------------------------------------------------------- input

/** Rows of a variable table with `name` set to `value`, enabled; added at the end when missing. */
export function setVariableRow(rows: KeyValue[], name: string, value: string): KeyValue[] {
  const index = rows.findIndex((row) => row.name === name)
  if (index < 0) return [...rows, { name, value, enabled: true, description: '' }]
  return rows.map((row, i) => (i === index ? { ...row, value, enabled: true } : row))
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
    const hovering = useVariableHover()
    const value = String(props.value ?? '')
    const tokens = status && value.includes('{{') ? variableTokens(value) : []
    const mirrored = tokens.length > 0
    const classes = bare ? className : cn(fieldClass, 'h-8', className)
    const input = useRef<HTMLInputElement | null>(null)
    const text = useRef<HTMLSpanElement>(null)
    const pointed = useRef<Element | null>(null)

    const sync = useCallback(() => {
      if (text.current && input.current) text.current.style.transform = `translateX(${-input.current.scrollLeft}px)`
    }, [])
    useLayoutEffect(sync, [sync, value, mirrored])

    const setRef = (node: HTMLInputElement | null): void => {
      input.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    }

    // The mirror lets the pointer through to the input: find the variable under it by position.
    const onMouseMove = (e: ReactMouseEvent): void => {
      if (!hovering || !text.current) return
      const under = [...text.current.querySelectorAll('[data-variable]')].find((span) => {
        const r = span.getBoundingClientRect()
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      })
      if (under === pointed.current) return
      pointed.current = under ?? null
      if (under) hovering.hover(under.getAttribute('data-variable')!, under.getBoundingClientRect())
      else hovering.leave()
    }
    const onMouseLeave = (): void => {
      if (pointed.current) hovering?.leave()
      pointed.current = null
    }

    const segments: ReactNode[] = []
    let at = 0
    for (const token of tokens) {
      if (token.start > at) segments.push(value.slice(at, token.start))
      segments.push(
        <span key={token.start} data-variable={token.name} className={COLORS[status!(token.name)]}>
          {value.slice(token.start, token.end)}
        </span>
      )
      at = token.end
    }
    if (at < value.length) segments.push(value.slice(at))

    return (
      <div className="relative w-full min-w-0" onMouseMove={mirrored ? onMouseMove : undefined} onMouseLeave={onMouseLeave}>
        <input
          ref={setRef}
          spellCheck={false}
          {...props}
          title={title}
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
