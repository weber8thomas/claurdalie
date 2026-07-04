import { describe, it, expect } from 'vitest'
import { computeConservation, computeMotif } from './compute'
import { newCounts, countColumn } from '../analysis/conservation/columnCounts'
import { scoreColumn } from '../analysis/conservation/methods'
import { compilePattern } from '../analysis/motif/findpatterns'

// Row-major flat alignment: 3 sequences × 4 columns.
//   col0 all A (conserved), col1 all distinct, col2 has a gap, col3 all gap.
const A = 1, C = 2, D = 3, GAP = 0
const flat = Uint8Array.from([
  A, A, GAP, GAP,
  A, C, C, GAP,
  A, D, GAP, GAP,
])
const nRows = 3
const width = 4

describe('computeConservation', () => {
  it('matches per-column direct scoring for every method', () => {
    const methods = ['threshold', 'shannon', 'jsd', 'meanDistance', 'vectorNorm', 'bild', 'liu', 'multi'] as const
    const res = computeConservation({ flat, nRows, width, methods: [...methods] })
    for (let col = 0; col < width; col++) {
      const counts = newCounts()
      const total = countColumn((r) => flat[r * width + col], nRows, counts)
      for (const m of methods) {
        const expected = scoreColumn(m, { counts, total }, nRows)
        const got = res.tracks[m].scores[col]
        if (Number.isNaN(expected)) expect(got).toBeNaN()
        else expect(got).toBeCloseTo(expected, 5)
      }
    }
  })

  it('reports per-column non-gap totals', () => {
    const res = computeConservation({ flat, nRows, width, methods: ['shannon'] })
    expect(Array.from(res.totals)).toEqual([3, 3, 1, 0])
  })

  it('conserved column outscores the diverse column (threshold)', () => {
    const res = computeConservation({ flat, nRows, width, methods: ['threshold'] })
    expect(res.tracks.threshold.scores[0]).toBeGreaterThan(res.tracks.threshold.scores[1])
  })

  it('produces automatic labels when requested', () => {
    const res = computeConservation({ flat, nRows, width, methods: ['threshold'], labels: true })
    expect(res.tracks.threshold.labels).toBeInstanceOf(Uint8Array)
    expect(res.tracks.threshold.labels!.length).toBe(width)
  })

  it('computes per-group tracks restricted to each group’s rows', () => {
    // Group 0 = rows {0,2} (A,A at col0 → conserved), group 1 = row {1} (A too).
    const res = computeConservation({
      flat,
      nRows,
      width,
      methods: ['threshold'],
      groups: [
        { id: 0, rows: [0, 2] },
        { id: 1, rows: [1] },
      ],
    })
    const gs = res.tracks.threshold.groupScores!
    expect(gs).toHaveLength(2)
    expect(gs[0].id).toBe(0)
    // Group 0 col0 is A,A → fully conserved.
    expect(gs[0].scores[0]).toBeCloseTo(100, 5)
    // Group 1 col1 is a single C → conserved within the group.
    expect(gs[1].scores[1]).toBeCloseTo(100, 5)
  })
})

describe('computeMotif', () => {
  // 2 sequences × 4 columns. A=1 C=2 D=3 GAP=0. Pattern "AC" should match the
  // aligned columns [0,2) in row 0 (A,C contiguous) and skip row 1 (A,gap,C).
  const A = 1, C = 2, D = 3, GAP = 0
  const rows = Uint8Array.from([
    A, C, D, GAP,
    A, GAP, C, D,
  ])

  it('returns aligned match ranges per row via the RegExp source', () => {
    const compiled = compilePattern('AC')
    expect(compiled.ok).toBe(true)
    const res = computeMotif({ flat: rows, nRows: 2, width: 4, source: (compiled as { source: string }).source })
    expect(res.matches).toHaveLength(2)
    // Row 0: ungapped "ACD" → "AC" at aligned cols [0,2).
    expect(res.matches[0].ranges).toEqual([[0, 2]])
    // Row 1: ungapped "ACD" (gap between A and C) → match spans aligned cols [0,3).
    expect(res.matches[1].ranges).toEqual([[0, 3]])
  })

  it('reports no matches when the pattern is absent', () => {
    const compiled = compilePattern('DDD')
    const res = computeMotif({ flat: rows, nRows: 2, width: 4, source: (compiled as { source: string }).source })
    expect(res.matches.every((m) => m.ranges.length === 0)).toBe(true)
  })
})
