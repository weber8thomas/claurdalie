import { describe, it, expect } from 'vitest'
import { ALPHABET_SIZE, charCodeToResidue } from '../../core/alphabet'
import type { ColumnStats } from '../../core/stats/ColumnStats'
import type { ScoreTrack, ConservationMethodId } from '../conservation/types'
import { scoreVariant, LOCAL_SCORER } from './localScorer'
import type { Variant, VariantContext } from './types'

const code = (ch: string) => charCodeToResidue(ch.charCodeAt(0))

// A minimal ColumnStats where the consensus is `consChar` at `frac` fraction.
function stats(col: number, consChar: string, frac: number): ColumnStats {
  const counts = new Uint16Array(ALPHABET_SIZE)
  const cc = code(consChar)
  counts[cc] = Math.round(frac * 100)
  return { col, counts, total: 100, consensus: cc, consensusFrac: frac }
}

// A VariantContext with a fixed conservation value (0..100) for every column and
// a fixed consensus residue, for isolated scorer testing (no app state).
function ctx(cons: number, consChar = 'A', frac = cons / 100): VariantContext {
  const track: ScoreTrack = { method: 'jsd', scores: new Float32Array(4096).fill(cons) }
  return {
    columnScores: (m: ConservationMethodId) => (m === 'jsd' ? track : undefined),
    columnStats: (col: number) => stats(col, consChar, frac),
  }
}

describe('localScorer — scoreVariant', () => {
  it('conserved column + radical substitution scores high', () => {
    // W→G in a highly-conserved column: radical swap where it matters most.
    const v: Variant = { seqName: 's', position: 5, from: 'W', to: 'G' }
    const s = scoreVariant(v, 10, ctx(95))
    expect(s.score).toBeGreaterThan(66)
  })

  it('conservative substitution scores low even in a conserved column', () => {
    // I→V is chemically near-neutral (BLOSUM +3); impact should stay low.
    const v: Variant = { seqName: 's', position: 3, from: 'I', to: 'V' }
    const s = scoreVariant(v, 4, ctx(95))
    expect(s.score).toBeLessThan(33)
  })

  it('radical substitution in a poorly-conserved column scores low', () => {
    // Same W→G but the column is variable → conservation dampens the impact.
    const v: Variant = { seqName: 's', position: 5, from: 'W', to: 'G' }
    const s = scoreVariant(v, 10, ctx(5))
    expect(s.score).toBeLessThan(40)
  })

  it('synonymous change (to === from) scores zero', () => {
    const v: Variant = { seqName: 's', position: 2, from: 'K', to: 'K' }
    const s = scoreVariant(v, 1, ctx(95))
    expect(s.score).toBe(0)
  })

  it('uses the column consensus as the reference when `from` is absent', () => {
    // No `from`; consensus is W, so W→G is still read as a radical swap.
    const v: Variant = { seqName: 's', position: 5, to: 'G' }
    const s = scoreVariant(v, 10, ctx(95, 'W'))
    expect(s.score).toBeGreaterThan(66)
  })

  it('unmapped variant (null column) scores zero with a note', () => {
    const v: Variant = { seqName: 's', position: 5, from: 'W', to: 'G' }
    const s = scoreVariant(v, null, ctx(95))
    expect(s.score).toBe(0)
    expect(s.column).toBeNull()
    expect(s.note).toMatch(/not mapped/i)
  })

  it('every score stays within 0..100 across a sweep of substitutions', () => {
    const residues = 'ACDEFGHIKLMNPQRSTVWY'
    for (const from of residues) {
      for (const to of residues) {
        for (const cons of [0, 50, 100]) {
          const s = scoreVariant({ seqName: 's', position: 1, from, to }, 0, ctx(cons))
          expect(s.score).toBeGreaterThanOrEqual(0)
          expect(s.score).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('a deletion (to === "-") scores as severe in a conserved column', () => {
    const v: Variant = { seqName: 's', position: 5, from: 'W', to: '-' }
    const s = scoreVariant(v, 10, ctx(95))
    expect(s.score).toBeGreaterThan(66)
  })
})

describe('LOCAL_SCORER source', () => {
  it('is offline and maps columns via ctx.map when scoring a batch', async () => {
    expect(LOCAL_SCORER.needsNetwork).toBe(false)
    // A trivial map: identity over an ungapped 5-residue row.
    const codes = new Uint8Array([code('W'), code('K'), code('I'), code('D'), code('E')])
    const { ResidueColumnMap } = await import('../../structure/mapping')
    const map = ResidueColumnMap.build(codes)
    const base = ctx(95, 'W')
    const withMap: VariantContext = { ...base, map }
    const out = await LOCAL_SCORER.score([{ seqName: 's', position: 1, from: 'W', to: 'G' }], withMap)
    expect(out).toHaveLength(1)
    expect(out[0].column).toBe(0)
    expect(out[0].score).toBeGreaterThan(66)
  })
})
