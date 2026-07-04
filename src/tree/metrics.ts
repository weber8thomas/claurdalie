// Pure phylogenetic-tree metrics used by the tree viewer: summary statistics,
// per-node info for hover tooltips, and patristic (path) distance between tips.

import type { PhyloTree, TreeNode } from './types'
import { leafNodes } from './types'

export interface TreeStats {
  leaves: number
  /** Sum of all branch lengths (root excluded). */
  totalLength: number
  /** Max cumulative root-to-tip branch length. */
  height: number
  /** Mean branch length over all non-root edges. */
  meanBranch: number
}

export function treeStats(tree: PhyloTree): TreeStats {
  let total = 0
  let edges = 0
  const walk = (n: TreeNode, acc: number, isRoot: boolean): number => {
    if (!isRoot) {
      total += n.length
      edges++
    }
    const d = acc + (isRoot ? 0 : n.length)
    if (n.children.length === 0) return d
    return Math.max(...n.children.map((c) => walk(c, d, false)))
  }
  const height = walk(tree.root, 0, true)
  return {
    leaves: leafNodes(tree.root).length,
    totalLength: total,
    height,
    meanBranch: edges ? total / edges : 0,
  }
}

export interface NodeInfo {
  isLeaf: boolean
  name?: string
  /** Branch length to the parent. */
  length: number
  /** Cumulative branch length from the root. */
  depth: number
  /** Bootstrap support (0..1) on the branch, if any. */
  support?: number
  /** Number of tips in this node's subtree. */
  leafCount: number
}

/** Info for the node with `id`, or null if not found. */
export function nodeInfo(tree: PhyloTree, id: number): NodeInfo | null {
  const walk = (n: TreeNode, depth: number): NodeInfo | null => {
    const d = depth + n.length
    if (n.id === id) {
      return {
        isLeaf: n.children.length === 0,
        name: n.name,
        length: n.length,
        depth: d,
        support: n.support,
        leafCount: n.children.length === 0 ? 1 : leafNodes(n).length,
      }
    }
    for (const c of n.children) {
      const hit = walk(c, d)
      if (hit) return hit
    }
    return null
  }
  return walk(tree.root, 0)
}

/** Root→node chain [root, …, node], or null if `id` is absent. */
function pathToRoot(root: TreeNode, id: number): TreeNode[] | null {
  const path: TreeNode[] = []
  const dfs = (n: TreeNode): boolean => {
    path.push(n)
    if (n.id === id) return true
    for (const c of n.children) if (dfs(c)) return true
    path.pop()
    return false
  }
  return dfs(root) ? path : null
}

/**
 * Patristic distance between two nodes: the sum of branch lengths along the
 * path connecting them through their lowest common ancestor. Returns null if
 * either id is missing.
 */
export function patristic(tree: PhyloTree, idA: number, idB: number): number | null {
  if (idA === idB) return 0
  const pa = pathToRoot(tree.root, idA)
  const pb = pathToRoot(tree.root, idB)
  if (!pa || !pb) return null
  // Advance past the shared prefix; the last shared node is the LCA.
  let i = 0
  while (i < pa.length && i < pb.length && pa[i].id === pb[i].id) i++
  let d = 0
  for (let k = i; k < pa.length; k++) d += pa[k].length
  for (let k = i; k < pb.length; k++) d += pb[k].length
  return d
}
