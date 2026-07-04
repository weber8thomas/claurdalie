import { describe, it, expect } from 'vitest'
import { charCodeToResidue, GAP_CODE } from '../../core/alphabet'
import { ResidueColumnMap } from '../../structure/mapping'
import { variantColumn } from './types'
import type { Variant } from './types'

// Build a full-width gapped row of residue codes from a string like "A-CD--E".
function row(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    out[i] = s[i] === '-' ? GAP_CODE : charCodeToResidue(s.charCodeAt(i))
  }
  return out
}

describe('variantColumn — residue index → alignment column on a gapped row', () => {
  // Row:      A  -  C  D  -  -  E
  // Column:   0  1  2  3  4  5  6
  // Ungapped: 1     2  3        4   (1-based positions the biologist reads)
  const map = ResidueColumnMap.build(row('A-CD--E'))

  it('maps a 1-based ungapped position to the correct column across gaps', () => {
    expect(variantColumn({ seqName: 's', position: 1, to: 'X' } as Variant, map)).toBe(0)
    expect(variantColumn({ seqName: 's', position: 2, to: 'X' } as Variant, map)).toBe(2)
    expect(variantColumn({ seqName: 's', position: 3, to: 'X' } as Variant, map)).toBe(3)
    expect(variantColumn({ seqName: 's', position: 4, to: 'X' } as Variant, map)).toBe(6)
  })

  it('returns null for positions past the ungapped length', () => {
    expect(variantColumn({ seqName: 's', position: 5, to: 'X' } as Variant, map)).toBeNull()
    expect(variantColumn({ seqName: 's', position: 0, to: 'X' } as Variant, map)).toBeNull()
  })

  it('round-trips column → residue → column through ResidueColumnMap', () => {
    // Column 3 holds ungapped residue index 2 (0-based), i.e. position 3.
    expect(map.residueAtColumn(3)).toBe(2)
    expect(map.columnOfResidue(2)).toBe(3)
    // A gap column has no residue.
    expect(map.residueAtColumn(1)).toBeNull()
  })
})
