import { describe, it, expect } from 'vitest'
import { applySubstitution } from './mutate'

describe('applySubstitution', () => {
  it('replaces the residue at a 1-based position, preserving length', () => {
    const r = applySubstitution('ACDEFG', 3, 'W')
    expect(r).not.toBeNull()
    expect(r!.sequence).toBe('ACWEFG')
    expect(r!.sequence.length).toBe(6)
    expect(r!.wild).toBe('D')
  })

  it('handles the first and last positions', () => {
    expect(applySubstitution('ACDEFG', 1, 'M')!.sequence).toBe('MCDEFG')
    expect(applySubstitution('ACDEFG', 6, 'M')!.sequence).toBe('ACDEFM')
  })

  it('uppercases the alternate residue', () => {
    expect(applySubstitution('ACDEFG', 2, 'k')!.sequence).toBe('AKDEFG')
  })

  it('returns null for out-of-range positions', () => {
    expect(applySubstitution('ACDEFG', 0, 'W')).toBeNull()
    expect(applySubstitution('ACDEFG', 7, 'W')).toBeNull()
  })

  it('returns null for non-canonical alternates (e.g. a deletion)', () => {
    expect(applySubstitution('ACDEFG', 3, '-')).toBeNull()
    expect(applySubstitution('ACDEFG', 3, 'B')).toBeNull()
    expect(applySubstitution('ACDEFG', 3, 'XY')).toBeNull()
  })
})
