import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@core/model'
import { countRequests, highlightRanges, searchTree, searchWords } from '@core/tree-search'

const request = (path: string, name: string): TreeNode => ({ kind: 'request', path, name, method: 'GET', seq: 0 })
const folder = (path: string, name: string, children: TreeNode[]): TreeNode => ({ kind: 'folder', path, name, seq: 0, children })

const tree: TreeNode[] = [
  folder('admin', 'Admin', [request('admin/create-user.yaml', 'Create user'), request('admin/delete-user.yaml', 'Delete user')]),
  folder('billing', 'Facturation', [
    folder('billing/invoices', 'Invoices', [request('billing/invoices/list.yaml', 'List invoices')]),
    request('billing/create.yaml', 'Créer un paiement')
  ]),
  request('ping.yaml', 'Ping')
]

const paths = (nodes: TreeNode[]): string[] =>
  nodes.flatMap((node) => (node.kind === 'request' ? [node.path] : [node.path, ...paths(node.children)]))

describe('searchTree', () => {
  it('keeps every node without a search', () => {
    expect(searchTree(tree, searchWords('   '))).toBe(tree)
  })

  it('keeps a matching folder with all its content', () => {
    expect(paths(searchTree(tree, searchWords('admin')))).toEqual(['admin', 'admin/create-user.yaml', 'admin/delete-user.yaml'])
  })

  it('keeps a matching request with its folders only', () => {
    expect(paths(searchTree(tree, searchWords('invoices list')))).toEqual(['billing', 'billing/invoices', 'billing/invoices/list.yaml'])
    expect(paths(searchTree(tree, searchWords('delete')))).toEqual(['admin', 'admin/delete-user.yaml'])
  })

  it('finds the words across a request and its folders, whatever the case and accents', () => {
    expect(paths(searchTree(tree, searchWords('ADMIN create')))).toEqual(['admin', 'admin/create-user.yaml'])
    expect(paths(searchTree(tree, searchWords('creer')))).toEqual(['billing', 'billing/create.yaml'])
    expect(searchTree(tree, searchWords('nothing here'))).toEqual([])
    expect(countRequests(searchTree(tree, searchWords('user')))).toBe(2)
  })
})

describe('highlightRanges', () => {
  it('marks every occurrence of the words, accents included', () => {
    expect(highlightRanges('Créer un paiement', ['creer', 'pai'])).toEqual([
      [0, 5],
      [9, 12]
    ])
    expect(highlightRanges('user users', ['user', 'se'])).toEqual([
      [0, 4],
      [5, 9]
    ])
  })
})
