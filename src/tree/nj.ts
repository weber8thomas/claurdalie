// Neighbor-joining (Saitou & Nei) from a distance matrix. Ordalie uses FastME;
// NJ is the well-understood distance method that runs comfortably client-side
// and recovers the same additive trees. Output is rooted at the final join
// (the user can re-root interactively). Negative branch lengths — which NJ can
// produce — are clamped to 0 for display.

import type { PhyloTree, TreeNode } from './types'

export function neighborJoin(D: Float64Array[], names: string[]): PhyloTree {
  const n = names.length
  let nextId = 0
  const mk = (name?: string): TreeNode => ({ id: nextId++, name, length: 0, children: [] })

  if (n === 0) return { root: mk(), leaves: [], bootstrap: 0 }
  if (n === 1) return { root: mk(names[0]), leaves: [...names], bootstrap: 0 }

  // Active clusters keyed by id; distances in a nested map.
  const node = new Map<number, TreeNode>()
  const active: number[] = []
  for (let i = 0; i < n; i++) {
    const leaf = mk(names[i])
    node.set(leaf.id, leaf)
    active.push(leaf.id)
  }
  const dist = new Map<number, Map<number, number>>()
  for (let i = 0; i < n; i++) {
    const row = new Map<number, number>()
    for (let j = 0; j < n; j++) if (i !== j) row.set(active[j], D[i][j])
    dist.set(active[i], row)
  }
  const d = (a: number, b: number) => dist.get(a)!.get(b)!

  while (active.length > 2) {
    const r = active.length
    // Net divergence per active cluster.
    const S = new Map<number, number>()
    for (const a of active) {
      let s = 0
      for (const b of active) if (a !== b) s += d(a, b)
      S.set(a, s)
    }
    // Minimize Q(i,j) = (r-2)·d(i,j) − S(i) − S(j).
    let bi = active[0]
    let bj = active[1]
    let bestQ = Infinity
    for (let x = 0; x < active.length; x++) {
      for (let y = x + 1; y < active.length; y++) {
        const i = active[x]
        const j = active[y]
        const q = (r - 2) * d(i, j) - S.get(i)! - S.get(j)!
        if (q < bestQ) {
          bestQ = q
          bi = i
          bj = j
        }
      }
    }
    const dij = d(bi, bj)
    let li = 0.5 * dij + (S.get(bi)! - S.get(bj)!) / (2 * (r - 2))
    let lj = dij - li
    li = Math.max(0, li)
    lj = Math.max(0, lj)
    const ni = node.get(bi)!
    const nj = node.get(bj)!
    ni.length = li
    nj.length = lj
    const u = mk()
    u.children = [ni, nj]
    node.set(u.id, u)
    // Distances from the new node to every other active cluster.
    const urow = new Map<number, number>()
    for (const k of active) {
      if (k === bi || k === bj) continue
      const duk = 0.5 * (d(bi, k) + d(bj, k) - dij)
      urow.set(k, duk)
      dist.get(k)!.set(u.id, duk)
    }
    dist.set(u.id, urow)
    // Retire bi, bj; add u.
    for (const k of active) {
      dist.get(k)?.delete(bi)
      dist.get(k)?.delete(bj)
    }
    dist.delete(bi)
    dist.delete(bj)
    const idx = active.filter((a) => a !== bi && a !== bj)
    idx.push(u.id)
    active.length = 0
    active.push(...idx)
  }

  // Two clusters remain — join them under a root, splitting the branch.
  const [a, b] = active
  const na = node.get(a)!
  const nb = node.get(b)!
  const half = Math.max(0, d(a, b) / 2)
  na.length = half
  nb.length = half
  const root = mk()
  root.children = [na, nb]
  return { root, leaves: [...names], bootstrap: 0 }
}
