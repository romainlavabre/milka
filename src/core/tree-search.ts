// Search in the tree of a collection, by folder and request names.
import type { TreeNode } from './model'

/** Lower case, without accents: "Créer" finds "creer" and the other way round. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Words of a search, normalized; empty when there is nothing to search. */
export function searchWords(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean)
}

/**
 * The part of the tree matching every word. A word is found in the name of a
 * node or of one of its folders, so "admin create" finds "Create user" in the
 * folder "admin". A matching folder keeps all its content; a matching request
 * keeps its folders.
 */
export function searchTree(nodes: TreeNode[], words: string[], ancestors = ''): TreeNode[] {
  if (words.length === 0) return nodes
  const found: TreeNode[] = []
  for (const node of nodes) {
    const names = `${ancestors} ${normalize(node.name)}`
    const matches = words.every((word) => names.includes(word))
    if (node.kind === 'request') {
      if (matches) found.push(node)
    } else if (matches) {
      found.push(node)
    } else {
      const children = searchTree(node.children, words, names)
      if (children.length > 0) found.push({ ...node, children })
    }
  }
  return found
}

/** Number of requests in a (searched) tree. */
export function countRequests(nodes: TreeNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.kind === 'request' ? 1 : countRequests(node.children)), 0)
}

/** Ranges of `text` to highlight for the searched words, merged and in order. */
export function highlightRanges(text: string, words: string[]): [number, number][] {
  // Accents are stripped character by character, so positions stay the same.
  const normalized = [...text].map((char) => normalize(char)).join('')
  if (normalized.length !== text.length) return []
  const ranges: [number, number][] = []
  for (const word of words) {
    for (let index = normalized.indexOf(word); index !== -1; index = normalized.indexOf(word, index + word.length)) {
      ranges.push([index, index + word.length])
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([...range])
  }
  return merged
}
