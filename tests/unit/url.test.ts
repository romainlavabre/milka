import { describe, expect, it } from 'vitest'
import { applyTypedUrl, displayUrl, pathParamNames } from '@core/url'
import type { Param } from '@core/model'

const p = (name: string, value: string, type: Param['type'] = 'query', enabled = true): Param => ({ name, value, type, enabled, description: '' })

describe('URL and params sync', () => {
  it('moves the query string into the params table', () => {
    const { url, params } = applyTypedUrl('{{baseUrl}}/users/:id?page=2&sort=name&flag', [p('id', '42', 'path'), p('off', '1', 'query', false)])
    expect(url).toBe('{{baseUrl}}/users/:id')
    expect(params).toEqual([p('id', '42', 'path'), p('page', '2'), p('sort', 'name'), p('flag', ''), p('off', '1', 'query', false)])
    expect(displayUrl(url, params)).toBe('{{baseUrl}}/users/:id?page=2&sort=name&flag')
  })

  it('finds path params only in the path', () => {
    expect(pathParamNames('https://api.io:8443/orgs/:org/repos/:repo?x=:no')).toEqual(['org', 'repo'])
    expect(applyTypedUrl('/orgs/:org', [p('repo', 'x', 'path')]).params).toEqual([p('org', '', 'path')])
  })
})
