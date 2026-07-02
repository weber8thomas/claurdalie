// Shared core types for the alignment model.

/**
 * A single aligned sequence (row).
 *
 * `codes` holds residues AND interior gaps (gap = code 0). Leading and trailing
 * gap runs are NOT materialized in `codes` — they are represented by the
 * `leadingGaps` / `trailingGaps` offsets. This makes "shift the whole sequence"
 * an O(1) offset tweak instead of copying a large array.
 *
 * The logical (aligned) length of a row is:
 *   leadingGaps + codes.length + trailingGaps
 */
export interface Row {
  /** Stable identity, never reused within a store's lifetime. */
  id: number
  name: string
  codes: Uint8Array
  leadingGaps: number
  trailingGaps: number
}

/** Describes what an edit changed, so the renderer/caches can invalidate minimally. */
export interface ChangeSet {
  /** Row ids whose residue content or offsets changed. */
  rows?: number[]
  /** [startCol, endCol) column range whose per-column stats are now stale. */
  columns?: [number, number]
  /** Alignment width changed → layout / scrollbars must recompute. */
  layoutChanged?: boolean
  /** Row visual order changed. */
  orderChanged?: boolean
}

export type StoreEvent =
  | 'rowsChanged'
  | 'layoutChanged'
  | 'orderChanged'
  | 'reset'

export type StoreListener = (change: ChangeSet) => void
