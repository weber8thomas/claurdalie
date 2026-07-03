// Pairwise %-identity analysis (Ordalie §4.3).
//
// A pure summary layer over the existing distance code: it reuses
// identityDistance() to get the N×N distance matrix, turns it into per-pair
// %-identity, and derives the readouts the Identity dialog shows — global
// summary stats, each sequence's closest / most-distant partner, and (when a
// grouping exists) the closest / most-distant partner WITHIN vs OUTSIDE the
// sequence's own cluster. No DOM, no store coupling: callers pass full-width
// gapped code rows (via store.materializeRow) plus names and an optional
// per-row cluster id.

import { GAP_CODE } from '../../core/alphabet'
import { identityDistance, type GapHandling } from '../cluster/distance'

/** A directed "best partner" reference: the other sequence + the %-identity. */
export interface Partner {
  /** Index into the input rows, or -1 when no eligible partner exists. */
  index: number
  pct: number
}

export interface PerSeqIdentity {
  /** Nearest and furthest partner over ALL other sequences. */
  closest: Partner
  mostDistant: Partner
  /** Same, restricted to the sequence's own cluster (null when no groups / alone). */
  closestWithin: Partner | null
  mostDistantWithin: Partner | null
  /** Same, restricted to sequences OUTSIDE the cluster (null when no groups). */
  closestOutside: Partner | null
  mostDistantOutside: Partner | null
}

export interface IdentitySummary {
  /** Mean / population stddev of all upper-triangle pair %-identities. */
  mean: number
  stddev: number
  /** Extreme pairs [i, j] (i < j) and their %-identity. */
  min: { i: number; j: number; pct: number }
  max: { i: number; j: number; pct: number }
  /** Number of pairs considered (n·(n−1)/2). */
  pairs: number
}

export interface IdentityReport {
  names: string[]
  /** Symmetric N×N %-identity (0..100), diagonal = 100. */
  pct: Float64Array[]
  /** Per-sequence ungapped residue count. */
  ungappedLen: number[]
  summary: IdentitySummary | null
  perSeq: PerSeqIdentity[]
}

export interface IdentityInput {
  rows: Uint8Array[]
  width: number
  names: string[]
  gap?: GapHandling
  /** Cluster id per row (same length as rows), or null/undefined for "no groups". */
  groupOf?: (number | null)[] | null
}

/** Count of non-gap residues in a full-width row. */
function ungappedLength(row: Uint8Array): number {
  let n = 0
  for (let i = 0; i < row.length; i++) if (row[i] !== GAP_CODE) n++
  return n
}

/** Columns where NEITHER row is a gap — the "ungapped compared length" of a pair. */
export function comparedLength(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  let compared = 0
  for (let c = 0; c < n; c++) if (a[c] !== GAP_CODE && b[c] !== GAP_CODE) compared++
  return compared
}

/** Build the full identity report for a set of aligned rows. */
export function computeIdentity(input: IdentityInput): IdentityReport {
  const { rows, width, names } = input
  const gap = input.gap ?? 'pairwise'
  const n = rows.length
  const D = identityDistance(rows, width, gap)
  const pct: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n))
  for (let i = 0; i < n; i++) {
    pct[i][i] = 100
    for (let j = i + 1; j < n; j++) {
      const p = 100 * (1 - D[i][j])
      pct[i][j] = p
      pct[j][i] = p
    }
  }

  const ungappedLen = rows.map(ungappedLength)

  // Global summary over the upper triangle.
  let summary: IdentitySummary | null = null
  const pairCount = (n * (n - 1)) / 2
  if (pairCount > 0) {
    let sum = 0
    let sumSq = 0
    let min = { i: 0, j: 1, pct: Infinity }
    let max = { i: 0, j: 1, pct: -Infinity }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const p = pct[i][j]
        sum += p
        sumSq += p * p
        if (p < min.pct) min = { i, j, pct: p }
        if (p > max.pct) max = { i, j, pct: p }
      }
    }
    const mean = sum / pairCount
    const variance = Math.max(0, sumSq / pairCount - mean * mean)
    summary = { mean, stddev: Math.sqrt(variance), min, max, pairs: pairCount }
  }

  const groupOf = input.groupOf ?? null
  const hasGroups = !!groupOf && groupOf.some((g) => g != null)

  const perSeq: PerSeqIdentity[] = []
  for (let i = 0; i < n; i++) {
    const all = bestPartners(pct, i, () => true)
    let closestWithin: Partner | null = null
    let mostDistantWithin: Partner | null = null
    let closestOutside: Partner | null = null
    let mostDistantOutside: Partner | null = null
    if (hasGroups) {
      const mine = groupOf![i]
      const within = bestPartners(pct, i, (j) => mine != null && groupOf![j] === mine)
      const outside = bestPartners(pct, i, (j) => mine == null || groupOf![j] !== mine)
      closestWithin = within.closest
      mostDistantWithin = within.mostDistant
      closestOutside = outside.closest
      mostDistantOutside = outside.mostDistant
    }
    perSeq.push({
      closest: all.closest,
      mostDistant: all.mostDistant,
      closestWithin,
      mostDistantWithin,
      closestOutside,
      mostDistantOutside,
    })
  }

  return { names, pct, ungappedLen, summary, perSeq }
}

const NO_PARTNER: Partner = { index: -1, pct: NaN }

/** Nearest / furthest partner of row i among rows j (j≠i) that pass `keep`. */
function bestPartners(
  pct: Float64Array[],
  i: number,
  keep: (j: number) => boolean,
): { closest: Partner; mostDistant: Partner } {
  const n = pct.length
  let closest = { ...NO_PARTNER }
  let mostDistant = { ...NO_PARTNER }
  let hiPct = -Infinity
  let loPct = Infinity
  for (let j = 0; j < n; j++) {
    if (j === i || !keep(j)) continue
    const p = pct[i][j]
    if (p > hiPct) {
      hiPct = p
      closest = { index: j, pct: p }
    }
    if (p < loPct) {
      loPct = p
      mostDistant = { index: j, pct: p }
    }
  }
  return { closest, mostDistant }
}

/** Read one cell of the report for the pairwise picker. */
export function pairIdentity(
  report: IdentityReport,
  rows: Uint8Array[],
  i: number,
  j: number,
): { pct: number; comparedLen: number } {
  return { pct: report.pct[i][j], comparedLen: comparedLength(rows[i], rows[j]) }
}
