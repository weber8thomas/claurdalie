import { describe, it, expect } from 'vitest'
import { superpose, applyTransform, applyTransformToPdb, parseCaCoords, type Mat3 } from './superpose'

type V3 = [number, number, number]

/** Rotation about Z by angle, row-major. */
function rotZ(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

describe('superpose (Kabsch/Horn)', () => {
  const ref: V3[] = [
    [0, 0, 0], [1, 0, 0], [0, 2, 0], [1, 1, 1], [2, 0, 1], [0, 3, 2], [1, 2, 3],
  ]

  it('recovers a known rotation + translation with ~0 RMSD', () => {
    const R0 = rotZ(0.7)
    const t0: V3 = [3, -2, 5]
    const mobile = ref.map((p) => applyTransform(p, R0, t0))
    const fit = superpose(mobile, ref)!
    expect(fit).not.toBeNull()
    expect(fit.rmsd).toBeLessThan(1e-6)
    // Applying the fit maps mobile back onto ref.
    for (let i = 0; i < ref.length; i++) {
      const p = applyTransform(mobile[i], fit.R, fit.t)
      expect(p[0]).toBeCloseTo(ref[i][0], 5)
      expect(p[1]).toBeCloseTo(ref[i][1], 5)
      expect(p[2]).toBeCloseTo(ref[i][2], 5)
    }
  })

  it('reports a non-zero RMSD for imperfect matches', () => {
    const mobile = ref.map((p, i) => [p[0] + (i % 2 ? 0.5 : -0.5), p[1], p[2]] as V3)
    const fit = superpose(mobile, ref)!
    expect(fit.rmsd).toBeGreaterThan(0.1)
  })

  it('matches by order up to the shorter length', () => {
    const fit = superpose(ref.slice(0, 5), ref)!
    expect(fit.n).toBe(5)
  })

  it('returns null when fewer than 3 points', () => {
    expect(superpose([[0, 0, 0]], [[0, 0, 0]])).toBeNull()
  })
})

describe('PDB coordinate transform', () => {
  const pdb = [
    'ATOM      1  N   MET A   1       0.000   0.000   0.000  1.00 42.50           N',
    'ATOM      2  CA  MET A   1       1.500   0.000   0.000  1.00 88.10           C',
    'ATOM      3  CA  ALA A   2       3.000   1.000   0.000  1.00 90.00           C',
  ].join('\n')

  it('parses Cα coordinates in order', () => {
    expect(parseCaCoords(pdb)).toEqual([
      [1.5, 0, 0],
      [3, 1, 0],
    ])
  })

  it('applies a transform and preserves non-coordinate columns', () => {
    const R = rotZ(Math.PI / 2)
    const t: V3 = [10, 0, 0]
    const moved = applyTransformToPdb(pdb, R, t)
    const cas = parseCaCoords(moved)
    // (1.5,0,0) rotated 90° about Z -> (0,1.5,0), +t -> (10,1.5,0)
    expect(cas[0][0]).toBeCloseTo(10, 3)
    expect(cas[0][1]).toBeCloseTo(1.5, 3)
    // B-factor / element columns intact.
    expect(moved.split('\n')[1]).toContain('88.10')
    expect(moved.split('\n')[1].trimEnd().endsWith('C')).toBe(true)
  })
})
