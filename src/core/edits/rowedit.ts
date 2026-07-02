import { GAP_CODE } from '../alphabet'
import { residueOf } from '../AlignmentStore'
import type { Row } from '../types'

// Low-level, in-place gap edits on a single Row, honoring the leading/trailing
// offset encoding so edge edits are O(1) and only interior edits touch `codes`.

/** Insert `count` gaps at logical column `col` in `row`. */
export function insertGapsInRow(row: Row, col: number, count: number): void {
  if (count <= 0) return
  const interiorStart = row.leadingGaps
  const interiorEnd = row.leadingGaps + row.codes.length
  if (col <= interiorStart) {
    row.leadingGaps += count
  } else if (col >= interiorEnd) {
    row.trailingGaps += count
  } else {
    const idx = col - interiorStart
    const next = new Uint8Array(row.codes.length + count)
    next.set(row.codes.subarray(0, idx), 0)
    // middle [idx, idx+count) stays 0 (gaps)
    next.set(row.codes.subarray(idx), idx + count)
    row.codes = next
  }
}

/**
 * How many contiguous gaps exist starting at logical `col`, up to `max`.
 * Used to clamp user-initiated deletions to only remove gaps.
 */
export function gapRunLength(row: Row, col: number, max: number): number {
  let n = 0
  while (n < max && residueOf(row, col + n) === GAP_CODE) n++
  return n
}

/**
 * Delete `count` gap cells starting at logical column `col`.
 * Caller must ensure all target cells are gaps (use gapRunLength to clamp).
 */
export function deleteGapsInRow(row: Row, col: number, count: number): void {
  if (count <= 0) return
  const L = row.leadingGaps
  const I = row.codes.length
  const interiorEnd = L + I
  const end = col + count

  const leadOverlap = overlap(col, end, 0, L)
  const interiorLo = Math.max(col, L)
  const interiorHi = Math.min(end, interiorEnd)
  const trailOverlap = overlap(col, end, interiorEnd, interiorEnd + row.trailingGaps)

  // Interior removal first (indices are relative to the original codes array).
  if (interiorHi > interiorLo) {
    const from = interiorLo - L
    const to = interiorHi - L
    const removed = to - from
    const next = new Uint8Array(row.codes.length - removed)
    next.set(row.codes.subarray(0, from), 0)
    next.set(row.codes.subarray(to), from)
    row.codes = next
  }
  if (leadOverlap > 0) row.leadingGaps -= leadOverlap
  if (trailOverlap > 0) row.trailingGaps -= trailOverlap
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}
