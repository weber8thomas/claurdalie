import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { newCounts, countColumn } from './columnCounts'
import { threshold, shannon, jsd, meanDistance, vectorNorm, bild, liu, multi, scoreColumn } from './methods'
import { autoLabels } from './automatic'
import { ALPHABET_SIZE, GAP_CODE } from '../../core/alphabet'
import { ColumnStatsCache } from '../../core/stats/ColumnStats'
import { AlignmentStore } from '../../core/AlignmentStore'
import type { ColumnInput } from './types'

// Build a ColumnInput from a list of residue codes.
function col(codes: number[]): ColumnInput {
  const counts = newCounts()
  const total = countColumn((r) => codes[r], codes.length, counts)
  return { counts, total }
}

// Alphabet is alphabetical: A C D E F G H I K L M N P Q R S T V W Y (gap = 0).
const A = 1 // Ala
const C = 2 // Cys
const D = 3 // Asp
const K = 9 // Lys
const R = 15 // Arg

describe('conservation methods — boundary behavior', () => {
  it('fully identical column → high conservation for all methods', () => {
    const c = col([A, A, A, A, A, A, A, A])
    // Frequency/similarity methods peg an identical column near 100.
    for (const m of ['threshold', 'shannon', 'meanDistance', 'vectorNorm', 'liu'] as const) {
      const s = scoreColumn(m, c, 8)
      expect(s, m).toBeGreaterThan(80)
    }
    // JSD and BILD score *relative to the background*: a conserved common
    // residue tops out lower than a conserved rare one (expected Capra–Singh /
    // log-odds behavior). They must still out-score a diverse column.
    const diverse = col([A, C, D, K, R])
    expect(jsd(c)).toBeGreaterThan(jsd(diverse))
    expect(bild(c)).toBeGreaterThan(bild(diverse))
    expect(threshold(c)).toBeCloseTo(100, 5)
    expect(shannon(c)).toBeCloseTo(100, 5)
  })

  it('maximally diverse column → low conservation for entropy-based methods', () => {
    // 20 distinct amino acids, one each.
    const codes = Array.from({ length: 20 }, (_, i) => i + 1)
    const c = col(codes)
    expect(shannon(c)).toBeCloseTo(0, 5) // entropy == log2(20) → score 0
    expect(threshold(c)).toBeCloseTo(5, 5) // consensus is 1/20
    expect(vectorNorm(c, 20)).toBeLessThan(30)
  })

  it('scores stay within [0,100]', () => {
    const samples = [col([A, C, D, K]), col([A, A, C]), col([K, K, K, K, D])]
    for (const c of samples) {
      for (const m of ['threshold', 'shannon', 'jsd', 'meanDistance', 'vectorNorm', 'bild', 'liu', 'multi'] as const) {
        const s = scoreColumn(m, c, 6)
        if (!Number.isNaN(s)) {
          expect(s, m).toBeGreaterThanOrEqual(0)
          expect(s, m).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('empty (all-gap) column → NaN', () => {
    const c = col([GAP_CODE, GAP_CODE, GAP_CODE])
    expect(threshold(c)).toBeNaN()
    expect(shannon(c)).toBeNaN()
    expect(jsd(c)).toBeNaN()
  })
})

describe('shannon — known value', () => {
  it('two residues 50/50 → entropy 1 bit', () => {
    const c = col([A, C]) // p = .5/.5, H = 1, score = (1 - 1/log2(20))*100
    const expected = (1 - 1 / (Math.log(20) / Math.log(2))) * 100
    expect(shannon(c)).toBeCloseTo(expected, 4)
  })
})

describe('meanDistance monotonicity', () => {
  it('identical > conservative substitution > dissimilar', () => {
    const same = meanDistance(col([K, K, K, K]))
    const conservative = meanDistance(col([K, R, K, R])) // K/R: positive BLOSUM
    const dissimilar = meanDistance(col([K, D, K, D])) // K/D: negative BLOSUM
    expect(same).toBeGreaterThan(conservative)
    expect(conservative).toBeGreaterThan(dissimilar)
  })
})

describe('multi = mean of the component methods', () => {
  it('averages the finite component scores', () => {
    const c = col([A, A, C, K])
    const m = multi(c, 4)
    // recompute mean of the seven single-pass methods
    const parts = [threshold, shannon, jsd, meanDistance, (x: ColumnInput) => vectorNorm(x, 4), bild, liu]
      .map((f) => f(c))
      .filter((x) => !Number.isNaN(x))
    const mean = parts.reduce((a, b) => a + b, 0) / parts.length
    expect(m).toBeCloseTo(mean, 4)
  })
})

describe('autoLabels', () => {
  it('labels the highest-scoring columns strictly conserved', () => {
    const scores = new Float32Array([100, 98, 95, 10, 8, 50, 52])
    const totals = new Uint16Array([9, 9, 9, 9, 9, 9, 9])
    const labels = autoLabels(scores, totals, 6)
    expect(labels[0]).toBe(2) // top cluster
    expect(labels[3]).toBe(0) // bottom cluster
  })
  it('ignores columns with too few residues', () => {
    const scores = new Float32Array([100, 100])
    const totals = new Uint16Array([9, 3]) // second below MIN_RESIDUES
    const labels = autoLabels(scores, totals, 6)
    expect(labels[1]).toBe(0)
  })
})

// The property that the on-screen coloring (ColumnStats) and the conservation
// counts agree: both go through countColumn, so per-column counts must match.
describe('columnCounts parity with ColumnStats', () => {
  it('ColumnStats.counts equals a direct countColumn over random alignments', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.integer({ min: 0, max: ALPHABET_SIZE - 1 }), { minLength: 1, maxLength: 12 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (rows) => {
          const width = Math.max(...rows.map((r) => r.length))
          const seqs = rows.map((r, i) => {
            const codes = new Uint8Array(width)
            for (let c = 0; c < r.length; c++) codes[c] = r[c]
            return { name: `s${i}`, codes }
          })
          const store = AlignmentStore.fromSequences(seqs)
          const stats = new ColumnStatsCache(store)
          for (let cIdx = 0; cIdx < width; cIdx++) {
            const direct = newCounts()
            countColumn((v) => store.residueAt(v, cIdx), store.height, direct)
            const s = stats.get(cIdx)
            expect(Array.from(s.counts)).toEqual(Array.from(direct))
          }
        },
      ),
      { numRuns: 60 },
    )
  })
})
