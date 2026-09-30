// Two-way sync between the URL bar and the params table: the stored URL has no
// query string, query and `:path` parameters live in the table.
import type { Param } from './model'

function param(name: string, value: string, type: Param['type']): Param {
  return { name, value, enabled: true, description: '', type }
}

/** Names of the `:name` path segments of a URL. */
export function pathParamNames(url: string): string[] {
  const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').split(/[?#]/)[0]
  return [...path.matchAll(/\/:([A-Za-z_][\w-]*)/g)].map((m) => m[1])
}

/** The URL shown in the URL bar: stored URL plus the enabled query params. */
export function displayUrl(url: string, params: Param[]): string {
  const query = params
    .filter((p) => p.type === 'query' && p.enabled && p.name)
    .map((p) => (p.value === '' ? p.name : `${p.name}=${p.value}`))
  return query.length ? `${url}?${query.join('&')}` : url
}

/**
 * Applies a URL typed in the URL bar: its query string replaces the enabled
 * query params (disabled ones are kept), path params follow the `:name` segments.
 */
export function applyTypedUrl(typed: string, params: Param[]): { url: string; params: Param[] } {
  const index = typed.indexOf('?')
  const url = index === -1 ? typed : typed.slice(0, index)
  const query = index === -1 ? '' : typed.slice(index + 1)
  const parsed = query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      return eq === -1 ? param(pair, '', 'query') : param(pair.slice(0, eq), pair.slice(eq + 1), 'query')
    })
  // Keep the descriptions of params that are still there.
  const previous = params.filter((p) => p.type === 'query' && p.enabled)
  const queryParams = parsed.map((p, i) => ({ ...p, description: previous[i]?.name === p.name ? previous[i].description : '' }))
  const disabled = params.filter((p) => p.type === 'query' && !p.enabled)
  return { url, params: [...syncPathParams(url, params), ...queryParams, ...disabled] }
}

/** Path params matching the `:name` segments of the URL, keeping known values. */
export function syncPathParams(url: string, params: Param[]): Param[] {
  return pathParamNames(url).map((name) => params.find((p) => p.type === 'path' && p.name === name) ?? param(name, '', 'path'))
}
