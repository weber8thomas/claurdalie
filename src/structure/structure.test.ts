import { describe, it, expect } from 'vitest'
import { charCodeToResidue, GAP_CODE } from '../core/alphabet'
import { toFoldInput } from './sanitize'
import { hashSequence, FoldCache } from './cache'
import { ResidueColumnMap } from './mapping'
import { parseCaPlddt, structureFromPdb } from './pdb'
import type { Structure } from './types'

/** Encode a display string ("AC-D") into full-width residue codes. */
function codesOf(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = charCodeToResidue(s.charCodeAt(i))
  return out
}

describe('toFoldInput', () => {
  it('strips gaps and preserves residue order', () => {
    const r = toFoldInput(codesOf('A-C--D'))
    expect(r.sequence).toBe('ACD')
    expect(r.raw).toBe('ACD')
    expect(r.substitutions).toBe(0)
  })

  it('substitutes non-standard residues to canonical and counts them', () => {
    // B->D, Z->E, X->A, U->C, O->K
    const r = toFoldInput(codesOf('BZXUO'))
    expect(r.raw).toBe('BZXUO')
    expect(r.sequence).toBe('DEACK')
    expect(r.substitutions).toBe(5)
  })

  it('handles an all-gap row as empty', () => {
    expect(toFoldInput(codesOf('----')).sequence).toBe('')
  })
})

describe('hashSequence / FoldCache', () => {
  it('is stable and content-addressed', () => {
    expect(hashSequence('ACDEF')).toBe(hashSequence('ACDEF'))
    expect(hashSequence('ACDEF')).not.toBe(hashSequence('ACDEG'))
  })

  it('caches by sequence, so gap edits (same residues) reuse the fold', () => {
    const cache = new FoldCache()
    const s: Structure = { pdb: 'X', plddt: [], residueCount: 3, origin: 'test' }
    cache.set('ACD', s)
    // Same ungapped sequence produced after a gap move → hit.
    expect(cache.get('ACD')).toBe(s)
    expect(cache.get('ACE')).toBeUndefined()
  })

  it('evicts least-recently-used beyond capacity', () => {
    const cache = new FoldCache(2)
    const mk = (id: string): Structure => ({ pdb: id, plddt: [], residueCount: 1, origin: id })
    cache.set('A', mk('A'))
    cache.set('B', mk('B'))
    cache.get('A') // touch A so B is now LRU
    cache.set('C', mk('C')) // evicts B
    expect(cache.get('A')).toBeDefined()
    expect(cache.get('C')).toBeDefined()
    expect(cache.get('B')).toBeUndefined()
  })
})

describe('ResidueColumnMap', () => {
  it('maps columns to residues and back across gaps', () => {
    //           col: 0 1 2 3 4 5
    //           seq: A - C - - D
    // residue index:  0    1     2   (0-based)
    const m = ResidueColumnMap.build(codesOf('A-C--D'))
    expect(m.residueCount).toBe(3)
    expect(m.residueAtColumn(0)).toBe(0)
    expect(m.residueAtColumn(1)).toBeNull() // gap
    expect(m.residueAtColumn(2)).toBe(1)
    expect(m.residueAtColumn(5)).toBe(2)
    expect(m.residueAtColumn(99)).toBeNull() // OOB

    expect(m.columnOfResidue(0)).toBe(0)
    expect(m.columnOfResidue(1)).toBe(2)
    expect(m.columnOfResidue(2)).toBe(5)
    expect(m.columnOfResidue(3)).toBeNull() // OOB
  })

  it('round-trips residue -> column -> residue for every residue', () => {
    const m = ResidueColumnMap.build(codesOf('--AC-DE-F'))
    for (let r = 0; r < m.residueCount; r++) {
      const col = m.columnOfResidue(r)
      expect(col).not.toBeNull()
      expect(m.residueAtColumn(col!)).toBe(r)
    }
  })
})

describe('pdb parsing', () => {
  const PDB = [
    'ATOM      1  N   MET A   1      0.000   0.000   0.000  1.00 42.50           N',
    'ATOM      2  CA  MET A   1      1.000   0.000   0.000  1.00 88.10           C',
    'ATOM      3  N   ALA A   2      2.000   0.000   0.000  1.00 30.00           N',
    'ATOM      4  CA  ALA A   2      3.000   0.000   0.000  1.00 95.30           C',
    'TER',
  ].join('\n')

  it('reads per-residue pLDDT off Cα B-factors in order', () => {
    expect(parseCaPlddt(PDB)).toEqual([88.1, 95.3])
  })

  it('builds a Structure with residue count and origin', () => {
    const s = structureFromPdb(PDB, 'ESMFold')
    expect(s.residueCount).toBe(2)
    expect(s.origin).toBe('ESMFold')
    expect(s.plddt).toEqual([88.1, 95.3])
  })

  it('throws on structure text with no Cα', () => {
    expect(() => structureFromPdb('HEADER only\nTER', 'x')).toThrow()
  })
})

// Guard the invariant the mapping relies on.
it('gap code is zero (mapping sentinel)', () => {
  expect(GAP_CODE).toBe(0)
})
