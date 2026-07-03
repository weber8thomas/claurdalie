// The single, shared column-counting kernel.
//
// Both ColumnStats (main thread, lazy per painted column) and the numerics
// worker (whole-track, off-thread) MUST count residues identically or the
// on-screen coloring and the computed conservation track would disagree. This
// function is that one implementation; a property test asserts parity.

import { ALPHABET_SIZE, GAP_CODE } from '../../core/alphabet'

/**
 * Tally residue codes for one column into `out` (length ALPHABET_SIZE, zeroed
 * by the caller). `get(row)` returns the residue code at that row for the
 * column. Returns the non-gap total.
 */
export function countColumn(
  get: (row: number) => number,
  nRows: number,
  out: Uint16Array,
): number {
  let total = 0
  for (let r = 0; r < nRows; r++) {
    const code = get(r)
    out[code]++
    if (code !== GAP_CODE) total++
  }
  return total
}

/** Fresh zeroed counts buffer. */
export function newCounts(): Uint16Array {
  return new Uint16Array(ALPHABET_SIZE)
}
