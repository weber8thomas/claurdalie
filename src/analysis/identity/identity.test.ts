import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { computeIdentity, comparedLength, pairIdentity } from './identity'

/** Build a fixed-width row from residue codes. */
function row(codes: number[], width = codes.length): Uint8Array {
  const u = new Uint8Array(width)
  codes.forEach((c, i) => (u[i] = c))
  return u
}

describe('computeIdentity — pairwise %-identity', () => {
  it('identical → 100, disjoint → 0, half-match → 50', () => {
    const rows = [row([1, 2, 3, 4]), row([1, 2, 3, 4]), row([5, 6, 7, 8]), row([1, 2, 7, 8])]
    const r = computeIdentity({ rows, width: 4, names: ['a', 'b', 'c', 'd'] })
    expect(r.pct[0][1]).toBeCloseTo(100, 10) // identical
    expect(r.pct[0][2]).toBeCloseTo(0, 10) // disjoint
    expect(r.pct[0][3]).toBeCloseTo(50, 10) // 2/4 match
    expect(r.pct[0][0]).toBe(100) // diagonal
  })

  it('is symmetric', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 4, maxLength: 8 }), {
          minLength: 2,
          maxLength: 6,
        }),
        (rowsArr) => {
          const width = Math.max(...rowsArr.map((r) => r.length))
          const rows = rowsArr.map((r) => row(r, width))
          const rep = computeIdentity({ rows, width, names: rows.map((_, i) => String(i)) })
          for (let i = 0; i < rows.length; i++)
            for (let j = 0; j < rows.length; j++)
              expect(rep.pct[i][j]).toBeCloseTo(rep.pct[j][i], 10)
        },
      ),
      { numRuns: 40 },
    )
  })

  it('ungapped length counts non-gap residues', () => {
    const rows = [row([1, 0, 2, 0, 3]), row([1, 2, 3, 4, 5])]
    const r = computeIdentity({ rows, width: 5, names: ['a', 'b'] })
    expect(r.ungappedLen).toEqual([3, 5])
  })

  it('global gap handling excludes any-gap columns', () => {
    // col 1 has a gap in b → excluded under global; pairwise compares cols 0 & 2.
    const rows = [row([1, 2, 3]), row([1, 0, 9])]
    const pw = computeIdentity({ rows, width: 3, names: ['a', 'b'], gap: 'pairwise' })
    const gl = computeIdentity({ rows, width: 3, names: ['a', 'b'], gap: 'global' })
    // pairwise: cols 0 (1==1) & 2 (3 vs 9) → 1/2 = 50
    expect(pw.pct[0][1]).toBeCloseTo(50, 10)
    // global: only col 0 & col 2 are ungapped across all → same set here → 50
    expect(gl.pct[0][1]).toBeCloseTo(50, 10)
  })
})

describe('computeIdentity — summary stats', () => {
  it('mean/min/max over the upper triangle', () => {
    // 3 rows: a≡b (100), a·c=0, b·c=0 → mean = (100+0+0)/3
    const rows = [row([1, 2]), row([1, 2]), row([3, 4])]
    const r = computeIdentity({ rows, width: 2, names: ['a', 'b', 'c'] })
    expect(r.summary).not.toBeNull()
    expect(r.summary!.pairs).toBe(3)
    expect(r.summary!.mean).toBeCloseTo(100 / 3, 10)
    expect(r.summary!.max.pct).toBeCloseTo(100, 10)
    expect(r.summary!.max).toMatchObject({ i: 0, j: 1 })
    expect(r.summary!.min.pct).toBeCloseTo(0, 10)
  })

  it('single sequence → no summary', () => {
    const r = computeIdentity({ rows: [row([1, 2, 3])], width: 3, names: ['a'] })
    expect(r.summary).toBeNull()
  })
})

describe('computeIdentity — closest / most-distant', () => {
  it('picks the nearest and furthest partner overall', () => {
    const rows = [row([1, 2, 3, 4]), row([1, 2, 3, 9]), row([5, 6, 7, 8])]
    const r = computeIdentity({ rows, width: 4, names: ['a', 'b', 'c'] })
    // row 0: closest is row 1 (75%), furthest is row 2 (0%).
    expect(r.perSeq[0].closest.index).toBe(1)
    expect(r.perSeq[0].closest.pct).toBeCloseTo(75, 10)
    expect(r.perSeq[0].mostDistant.index).toBe(2)
    expect(r.perSeq[0].mostDistant.pct).toBeCloseTo(0, 10)
  })

  it('within vs outside cluster when groups are supplied', () => {
    // Group 0 = {0,1} very similar; group 1 = {2,3} very similar; groups differ.
    const rows = [
      row([1, 2, 3, 4]),
      row([1, 2, 3, 9]), // ~group 0
      row([5, 6, 7, 8]),
      row([5, 6, 7, 1]), // ~group 1
    ]
    const r = computeIdentity({
      rows,
      width: 4,
      names: ['a', 'b', 'c', 'd'],
      groupOf: [0, 0, 1, 1],
    })
    const s0 = r.perSeq[0]
    // Closest within cluster 0 is row 1 (75%); closest outside is in cluster 1 (< within).
    expect(s0.closestWithin!.index).toBe(1)
    expect(s0.closestWithin!.pct).toBeCloseTo(75, 10)
    expect([2, 3]).toContain(s0.closestOutside!.index)
    expect(s0.closestWithin!.pct).toBeGreaterThan(s0.closestOutside!.pct)
  })

  it('no groups → within/outside are null', () => {
    const rows = [row([1, 2]), row([1, 3])]
    const r = computeIdentity({ rows, width: 2, names: ['a', 'b'] })
    expect(r.perSeq[0].closestWithin).toBeNull()
    expect(r.perSeq[0].closestOutside).toBeNull()
  })
})

describe('comparedLength / pairIdentity', () => {
  it('comparedLength counts columns ungapped in both', () => {
    expect(comparedLength(row([1, 0, 3, 4]), row([1, 2, 0, 4]))).toBe(2) // cols 0 & 3
  })
  it('pairIdentity returns pct + comparedLen', () => {
    const rows = [row([1, 2, 3, 4]), row([1, 2, 7, 8])]
    const r = computeIdentity({ rows, width: 4, names: ['a', 'b'] })
    const p = pairIdentity(r, rows, 0, 1)
    expect(p.pct).toBeCloseTo(50, 10)
    expect(p.comparedLen).toBe(4)
  })
})
