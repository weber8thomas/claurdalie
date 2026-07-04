import { describe, it, expect } from 'vitest'
import { neighborJoin } from './nj'
import { serializeNewick, parseNewick, parseNexus } from './newick'
import { bootstrapSupport } from './bootstrap'
import { treeStats, nodeInfo, patristic } from './metrics'
import { identityDistance } from '../analysis/cluster/distance'
import { leafNodes, countNodes, type TreeNode } from './types'

// Classic additive distance matrix (Saitou & Nei style) over 4 taxa where the
// true topology groups (A,B) and (C,D).
function matrix(rows: number[][]): Float64Array[] {
  return rows.map((r) => Float64Array.from(r))
}

// A,B close; C,D close; the two pairs far apart.
const D4 = matrix([
  [0, 2, 8, 8],
  [2, 0, 8, 8],
  [8, 8, 0, 2],
  [8, 8, 2, 0],
])
const NAMES = ['A', 'B', 'C', 'D']

/** Set of leaf-name sets for every internal node's descendants (unordered). */
function clades(root: TreeNode): Set<string> {
  const out = new Set<string>()
  const walk = (n: TreeNode): string[] => {
    if (n.children.length === 0) return [n.name!]
    const leaves = n.children.flatMap(walk)
    out.add([...leaves].sort().join(','))
    return leaves
  }
  walk(root)
  return out
}

describe('neighborJoin', () => {
  it('recovers the (A,B)(C,D) grouping', () => {
    const tree = neighborJoin(D4, NAMES)
    const cl = clades(tree.root)
    expect(cl.has('A,B') || cl.has('C,D')).toBe(true)
    // All four taxa are present as leaves.
    expect(leafNodes(tree.root).map((l) => l.name).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('handles trivial sizes', () => {
    expect(leafNodes(neighborJoin(matrix([[0]]), ['X']).root)).toHaveLength(1)
    expect(leafNodes(neighborJoin(matrix([[0, 1], [1, 0]]), ['X', 'Y']).root)).toHaveLength(2)
  })

  it('branch lengths are non-negative', () => {
    const tree = neighborJoin(D4, NAMES)
    const walk = (n: TreeNode) => {
      expect(n.length).toBeGreaterThanOrEqual(0)
      n.children.forEach(walk)
    }
    walk(tree.root)
  })
})

describe('newick round-trip', () => {
  it('serialize → parse preserves topology and leaf set', () => {
    const tree = neighborJoin(D4, NAMES)
    const nwk = serializeNewick(tree)
    const back = parseNewick(nwk)
    expect(leafNodes(back.root).map((l) => l.name).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(clades(back.root)).toEqual(clades(tree.root))
    expect(countNodes(back.root)).toBe(countNodes(tree.root))
  })

  it('parses a simple Newick string with lengths', () => {
    const t = parseNewick('((A:1,B:1):2,(C:1,D:1):2);')
    expect(leafNodes(t.root).map((l) => l.name).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(clades(t.root).has('A,B')).toBe(true)
    expect(clades(t.root).has('C,D')).toBe(true)
  })
})

describe('NEXUS import', () => {
  it('parses a trees block with a translate table', () => {
    const nex = `#NEXUS
begin trees;
  translate
    1 Human,
    2 Chimp,
    3 Mouse;
  tree t1 = ((1:0.1,2:0.1):0.2,3:0.3);
end;`
    const t = parseNexus(nex)
    expect(leafNodes(t.root).map((l) => l.name).sort()).toEqual(['Chimp', 'Human', 'Mouse'])
  })
})

describe('metrics', () => {
  const t = parseNewick('((A:1,B:1):2,(C:1,D:1):2);')
  const idOf = (name: string) => leafNodes(t.root).find((l) => l.name === name)!.id

  it('treeStats sums lengths and finds tree height', () => {
    const s = treeStats(t)
    expect(s.leaves).toBe(4)
    expect(s.totalLength).toBeCloseTo(8) // 1+1+2 + 1+1+2
    expect(s.height).toBeCloseTo(3) // 2 (internal) + 1 (tip)
    expect(s.meanBranch).toBeCloseTo(8 / 6)
  })

  it('patristic distance goes through the LCA', () => {
    expect(patristic(t, idOf('A'), idOf('A'))).toBe(0)
    expect(patristic(t, idOf('A'), idOf('B'))).toBeCloseTo(2) // 1 + 1
    expect(patristic(t, idOf('A'), idOf('C'))).toBeCloseTo(6) // (1+2) + (2+1)
  })

  it('nodeInfo reports leaf name, depth and subtree size', () => {
    const a = nodeInfo(t, idOf('A'))!
    expect(a.isLeaf).toBe(true)
    expect(a.name).toBe('A')
    expect(a.depth).toBeCloseTo(3) // 2 + 1
    expect(a.leafCount).toBe(1)
    expect(nodeInfo(t, 999_999)).toBeNull()
  })
})

describe('bootstrap', () => {
  it('assigns support in [0,1] and is deterministic for a fixed seed', () => {
    // Two clear pairs: {A,B} vs {C,D}.
    const rows = [
      Uint8Array.from([1, 2, 3, 4, 5, 6]),
      Uint8Array.from([1, 2, 3, 4, 5, 7]),
      Uint8Array.from([9, 9, 9, 9, 9, 9]),
      Uint8Array.from([9, 9, 9, 9, 9, 8]),
    ]
    const names = ['A', 'B', 'C', 'D']
    const ref = neighborJoin(identityDistance(rows, 6), names)
    bootstrapSupport(rows, 6, names, ref, 50, 42)
    expect(ref.bootstrap).toBe(50)

    const supports: number[] = []
    const walk = (n: TreeNode) => {
      if (n.support !== undefined) {
        expect(n.support).toBeGreaterThanOrEqual(0)
        expect(n.support).toBeLessThanOrEqual(1)
        supports.push(n.support)
      }
      n.children.forEach(walk)
    }
    walk(ref.root)
    expect(supports.length).toBeGreaterThan(0)

    // Same seed → identical support.
    const ref2 = neighborJoin(identityDistance(rows, 6), names)
    bootstrapSupport(rows, 6, names, ref2, 50, 42)
    const s2: number[] = []
    const walk2 = (n: TreeNode) => {
      if (n.support !== undefined) s2.push(n.support)
      n.children.forEach(walk2)
    }
    walk2(ref2.root)
    expect(s2).toEqual(supports)
  })
})
