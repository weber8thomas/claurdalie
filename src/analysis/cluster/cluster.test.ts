import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { identityDistance, euclideanDistance } from './distance'
import { kmeans, autoKmeans, autoMixture, hierarchic, dpc } from './methods'
import { buildFeatureMatrix } from './criteria'

// Two well-separated 2-D blobs: items 0..3 near origin, 4..7 near (10,10).
const BLOBS: Float64Array[] = [
  [0, 0], [0.5, 0.3], [0.2, -0.4], [-0.3, 0.1],
  [10, 10], [10.4, 9.7], [9.6, 10.2], [10.1, 9.9],
].map((p) => Float64Array.from(p))

/** True if items 0..3 form one cluster and 4..7 another (labels may differ). */
function recoversTwoBlobs(assign: number[]): boolean {
  const a = new Set(assign.slice(0, 4))
  const b = new Set(assign.slice(4))
  return a.size === 1 && b.size === 1 && [...a][0] !== [...b][0]
}

describe('identityDistance', () => {
  it('is symmetric with a zero diagonal; identical rows → 0', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 4, maxLength: 10 }), {
          minLength: 2,
          maxLength: 6,
        }),
        (rowsArr) => {
          const width = Math.max(...rowsArr.map((r) => r.length))
          const rows = rowsArr.map((r) => {
            const u = new Uint8Array(width)
            r.forEach((c, i) => (u[i] = c))
            return u
          })
          const D = identityDistance(rows, width)
          for (let i = 0; i < rows.length; i++) {
            expect(D[i][i]).toBe(0)
            for (let j = 0; j < rows.length; j++) expect(D[i][j]).toBeCloseTo(D[j][i], 10)
          }
        },
      ),
      { numRuns: 40 },
    )
  })

  it('identical sequences have distance 0, disjoint have distance 1', () => {
    const a = Uint8Array.from([1, 2, 3, 4])
    const same = Uint8Array.from([1, 2, 3, 4])
    const diff = Uint8Array.from([5, 6, 7, 8])
    const D = identityDistance([a, same, diff], 4)
    expect(D[0][1]).toBeCloseTo(0, 10)
    expect(D[0][2]).toBeCloseTo(1, 10)
  })

  it('global gap handling only compares fully-ungapped columns', () => {
    // col 1 has a gap in row b → excluded under global.
    const a = Uint8Array.from([1, 2, 3])
    const b = Uint8Array.from([1, 0, 9]) // gap at col 1
    const D = identityDistance([a, b], 3, 'global')
    // compared columns: 0 (1==1 same) and 2 (3 vs 9 differ) → identity 0.5 → dist 0.5
    expect(D[0][1]).toBeCloseTo(0.5, 10)
  })
})

describe('vector clustering recovers separated blobs', () => {
  it('kmeans(k=2)', () => {
    expect(recoversTwoBlobs(kmeans(BLOBS, 2))).toBe(true)
  })
  it('autoKmeans picks k=2', () => {
    const out = autoKmeans(BLOBS)
    expect(out.k).toBe(2)
    expect(recoversTwoBlobs(out.assignments)).toBe(true)
  })
  it('autoMixture/AIC and /BIC pick k=2', () => {
    for (const crit of ['aic', 'bic'] as const) {
      const out = autoMixture(BLOBS, crit)
      expect(out.k, crit).toBe(2)
      expect(recoversTwoBlobs(out.assignments), crit).toBe(true)
    }
  })
})

describe('distance clustering recovers separated blobs', () => {
  it('hierarchic', () => {
    const out = hierarchic(euclideanDistance(BLOBS))
    expect(out.k).toBe(2)
    expect(recoversTwoBlobs(out.assignments)).toBe(true)
  })

  it('dpc (data with density cores)', () => {
    // DPC keys off density peaks, so give each group a dense core (as real
    // sequence-identity data has) — 3 tight points + 2 satellites per group.
    const CORED: Float64Array[] = [
      [0, 0], [0.04, 0], [0, 0.04], [0.6, 0.4], [-0.5, 0.3],
      [10, 10], [10.04, 10], [10, 10.04], [10.6, 9.6], [9.5, 10.4],
    ].map((p) => Float64Array.from(p))
    const out = dpc(euclideanDistance(CORED))
    const a = new Set(out.assignments.slice(0, 5))
    const b = new Set(out.assignments.slice(5))
    expect(a.size).toBe(1)
    expect(b.size).toBe(1)
    expect([...a][0]).not.toBe([...b][0])
  })
})

describe('buildFeatureMatrix', () => {
  it('z-scores each dimension (mean ≈ 0)', () => {
    const seqs = [
      { codes: Uint8Array.from([1, 1, 1, 2]) },
      { codes: Uint8Array.from([1, 2, 3, 4]) },
      { codes: Uint8Array.from([5, 5, 6, 6]) },
    ]
    const { vectors, dims } = buildFeatureMatrix(seqs, ['length', 'pI'])
    expect(dims).toBe(2)
    for (let d = 0; d < dims; d++) {
      const mean = vectors.reduce((a, v) => a + v[d], 0) / vectors.length
      expect(mean).toBeCloseTo(0, 6)
    }
  })
})
