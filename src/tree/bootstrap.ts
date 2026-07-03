// Phylogenetic bootstrap: resample alignment columns with replacement N times,
// rebuild the NJ tree for each replicate, and record how often each branch
// (bipartition) of the reference tree recurs. Support is stored on the node as
// a 0..1 fraction. Deterministic: a seeded PRNG (no Math.random, which the
// worker forbids), so identical inputs give identical support.

import { identityDistanceOverColumns } from '../analysis/cluster/distance'
import { neighborJoin } from './nj'
import type { PhyloTree, TreeNode } from './types'

/** mulberry32 — small, fast, deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Canonical bipartition key for a clade (set of leaf indices) over nLeaves:
 * always describe the side NOT containing leaf 0, so complementary clades from
 * differently-rooted trees compare equal.
 */
function bipartitionKey(indices: number[], nLeaves: number): string | null {
  const set = new Set(indices)
  if (set.size < 2 || set.size > nLeaves - 2) return null // trivial split
  const side = set.has(0) ? Array.from({ length: nLeaves }, (_, i) => i).filter((i) => !set.has(i)) : indices.slice()
  return side.sort((a, b) => a - b).join(',')
}

/** Collect every non-trivial bipartition key present in a tree. */
function bipartitions(root: TreeNode, leafIndex: Map<string, number>, nLeaves: number): Map<string, TreeNode> {
  const out = new Map<string, TreeNode>()
  const walk = (n: TreeNode): number[] => {
    if (n.children.length === 0) {
      const idx = leafIndex.get(n.name ?? '')
      return idx === undefined ? [] : [idx]
    }
    const leaves = n.children.flatMap(walk)
    const key = bipartitionKey(leaves, nLeaves)
    if (key) out.set(key, n)
    return leaves
  }
  walk(root)
  return out
}

/**
 * Annotate `refTree` in place with bootstrap support over N replicates. `rows`
 * are the aligned sequences (visual order matching `names`), `width` the column
 * count.
 */
export function bootstrapSupport(
  rows: Uint8Array[],
  width: number,
  names: string[],
  refTree: PhyloTree,
  N: number,
  seed = 1,
): void {
  const nLeaves = names.length
  if (nLeaves < 4 || N <= 0 || width === 0) return
  const leafIndex = new Map<string, number>()
  names.forEach((nm, i) => leafIndex.set(nm, i))

  const refBips = bipartitions(refTree.root, leafIndex, nLeaves)
  const counts = new Map<string, number>()
  for (const key of refBips.keys()) counts.set(key, 0)

  const rand = rng(seed)
  const cols = new Array(width)
  for (let rep = 0; rep < N; rep++) {
    for (let c = 0; c < width; c++) cols[c] = Math.floor(rand() * width)
    const D = identityDistanceOverColumns(rows, cols)
    const tree = neighborJoin(D, names)
    const bips = bipartitions(tree.root, leafIndex, nLeaves)
    for (const key of refBips.keys()) if (bips.has(key)) counts.set(key, counts.get(key)! + 1)
  }

  for (const [key, node] of refBips) node.support = (counts.get(key) ?? 0) / N
  refTree.bootstrap = N
}
