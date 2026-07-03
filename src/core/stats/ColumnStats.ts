import { ALPHABET_SIZE } from '../alphabet'
import type { AlignmentStore } from '../AlignmentStore'
import { countColumn } from '../../analysis/conservation/columnCounts'

/** Per-column residue frequencies and consensus, computed lazily and cached. */
export interface ColumnStats {
  col: number
  counts: Uint16Array // length ALPHABET_SIZE
  total: number // non-gap count
  consensus: number // most frequent non-gap residue code (0 if none)
  consensusFrac: number // consensus count / non-gap total
}

/**
 * Lazy per-column stats cache. Computing one column scans all rows at that
 * column: O(height). We only ever compute columns that are actually painted,
 * so cost tracks the viewport, not the alignment.
 */
export class ColumnStatsCache {
  private cache = new Map<number, ColumnStats>()
  constructor(private store: AlignmentStore) {}

  get(col: number): ColumnStats {
    let s = this.cache.get(col)
    if (!s) {
      s = this.compute(col)
      this.cache.set(col, s)
    }
    return s
  }

  /** Drop cached stats for a column range [lo, hi). */
  invalidate(lo: number, hi: number): void {
    if (hi - lo > this.cache.size) {
      this.cache.clear()
      return
    }
    for (let c = lo; c < hi; c++) this.cache.delete(c)
  }

  clear(): void {
    this.cache.clear()
  }

  private compute(col: number): ColumnStats {
    const counts = new Uint16Array(ALPHABET_SIZE)
    const h = this.store.height
    const total = countColumn((v) => this.store.residueAt(v, col), h, counts)
    let consensus = 0
    let best = 0
    for (let c = 1; c < ALPHABET_SIZE; c++) {
      if (counts[c] > best) {
        best = counts[c]
        consensus = c
      }
    }
    return {
      col,
      counts,
      total,
      consensus,
      consensusFrac: total > 0 ? best / total : 0,
    }
  }
}
