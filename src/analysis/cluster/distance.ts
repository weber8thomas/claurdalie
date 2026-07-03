// Pairwise distance matrices — shared by clustering (v0.5) and the tree (v0.6).
//
// Two flavors:
//  - identityDistance: 1 − fractional identity between aligned sequences, with
//    Pairwise (ignore a column if either sequence has a gap there) or Global
//    (only fully-ungapped columns across the whole set) gap handling.
//  - euclideanDistance: L2 over z-scored criterion feature vectors.
// Both return a dense symmetric matrix (Float64Array[]) with a zero diagonal.

import { GAP_CODE } from '../../core/alphabet'

export type GapHandling = 'pairwise' | 'global'

/** Fractional identity over compared (non-gap) columns of two aligned rows. */
function pairIdentity(a: Uint8Array, b: Uint8Array, cols: number[] | null): number {
  let same = 0
  let compared = 0
  const n = Math.min(a.length, b.length)
  const scan = (c: number) => {
    const ca = a[c]
    const cb = b[c]
    if (ca === GAP_CODE || cb === GAP_CODE) return
    compared++
    if (ca === cb) same++
  }
  if (cols) for (const c of cols) scan(c)
  else for (let c = 0; c < n; c++) scan(c)
  return compared === 0 ? 0 : same / compared
}

/** Columns with no gaps in ANY row (for Global gap handling). */
function ungappedColumns(rows: Uint8Array[], width: number): number[] {
  const cols: number[] = []
  outer: for (let c = 0; c < width; c++) {
    for (const r of rows) if ((r[c] ?? GAP_CODE) === GAP_CODE) continue outer
    cols.push(c)
  }
  return cols
}

/**
 * Distance matrix from pairwise %-identity. `zones` restricts to column ranges
 * (empty = whole width). Distance = 1 − identity, so identical rows → 0.
 */
export function identityDistance(
  rows: Uint8Array[],
  width: number,
  gap: GapHandling = 'pairwise',
  zones: [number, number][] = [],
): Float64Array[] {
  // Resolve the column set once.
  let cols: number[] | null = null
  if (zones.length > 0) {
    cols = []
    for (const [s, e] of zones) for (let c = s; c <= e && c < width; c++) cols.push(c)
  }
  if (gap === 'global') {
    const base = cols ?? Array.from({ length: width }, (_, i) => i)
    const ug = ungappedColumns(rows, width)
    const ugSet = new Set(ug)
    cols = base.filter((c) => ugSet.has(c))
  }
  const n = rows.length
  const D: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = 1 - pairIdentity(rows[i], rows[j], cols)
      D[i][j] = d
      D[j][i] = d
    }
  }
  return D
}

/** Euclidean distance matrix over feature vectors (already z-scored). */
export function euclideanDistance(vectors: Float64Array[]): Float64Array[] {
  const n = vectors.length
  const D: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0
      const a = vectors[i]
      const b = vectors[j]
      for (let d = 0; d < a.length; d++) s += (a[d] - b[d]) ** 2
      const dist = Math.sqrt(s)
      D[i][j] = dist
      D[j][i] = dist
    }
  }
  return D
}
