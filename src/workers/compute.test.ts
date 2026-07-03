import { describe, it, expect } from 'vitest'
import { computeConservation } from './compute'
import { newCounts, countColumn } from '../analysis/conservation/columnCounts'
import { scoreColumn } from '../analysis/conservation/methods'

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
})
