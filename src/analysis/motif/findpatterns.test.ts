import { describe, it, expect } from 'vitest'
import { charCodeToResidue } from '../../core/alphabet'
import { compilePattern, findMatches, buildUngapped, type CompileOk } from './findpatterns'

/** Build a full-width row from letters; '-' (or '.') is a gap. */
function row(letters: string): Uint8Array {
  const u = new Uint8Array(letters.length)
  for (let i = 0; i < letters.length; i++) u[i] = charCodeToResidue(letters.charCodeAt(i))
  return u
}

/** Compile (asserting success) and return the aligned ranges for one sequence. */
function match(pattern: string, seq: string): [number, number][] {
  const c = compilePattern(pattern)
  expect(c.ok, `compile "${pattern}": ${c.ok ? '' : c.error}`).toBe(true)
  return findMatches([row(seq)], c as CompileOk)[0].ranges
}

describe('compilePattern — errors', () => {
  it('rejects empty / whitespace-only patterns', () => {
    expect(compilePattern('').ok).toBe(false)
    expect(compilePattern('   ').ok).toBe(false)
  })
  it('rejects nested groups', () => {
    expect(compilePattern('(A(B))').ok).toBe(false)
  })
  it('rejects unbalanced parens and bad repeats', () => {
    expect(compilePattern('(AC').ok).toBe(false)
    expect(compilePattern('A{3,1}').ok).toBe(false)
    expect(compilePattern('A{x}').ok).toBe(false)
  })
  it('rejects invalid residue letters', () => {
    expect(compilePattern('J').ok).toBe(false) // J is not in the alphabet
  })
  it('rejects misplaced anchors', () => {
    expect(compilePattern('A<B').ok).toBe(false)
    expect(compilePattern('A>B').ok).toBe(false)
  })
})

describe('findMatches — operators', () => {
  it('literal single & multi residue', () => {
    expect(match('W', 'ACWDE')).toEqual([[2, 3]])
    expect(match('CWD', 'ACWDE')).toEqual([[1, 4]])
  })

  it('X (any residue)', () => {
    expect(match('AXC', 'ADC')).toEqual([[0, 3]])
    expect(match('AXC', 'AC')).toEqual([]) // too short
  })

  it('ambiguity B (D or N) and Z (E or Q)', () => {
    expect(match('B', 'DN')).toEqual([
      [0, 1],
      [1, 2],
    ])
    expect(match('Z', 'EQ')).toEqual([
      [0, 1],
      [1, 2],
    ])
  })

  it('groups with {min,max} repeats (greedy)', () => {
    expect(match('(AC){1,3}', 'ACACAC')).toEqual([[0, 6]])
    expect(match('A{2,4}', 'AAAAA')).toEqual([[0, 4]])
  })

  it('comma-OR inside a group', () => {
    expect(match('(A,C,D)', 'CGA')).toEqual([
      [0, 1],
      [2, 3],
    ])
  })

  it('~ NOT single and grouped', () => {
    expect(match('~A', 'AWA')).toEqual([[1, 2]])
    expect(match('~(A,T)', 'ATCA')).toEqual([[2, 3]])
  })

  it('anchors < (begin) and > (end)', () => {
    expect(match('<M', 'MAAA')).toEqual([[0, 1]])
    expect(match('<M', 'AMAA')).toEqual([])
    expect(match('K>', 'AAK')).toEqual([[2, 3]])
    expect(match('K>', 'AAKA')).toEqual([])
  })

  it('case-insensitive and whitespace-insensitive', () => {
    expect(match('c w d', 'ACWDE')).toEqual([[1, 4]])
  })
})

describe('findMatches — aligned-column translation across gaps', () => {
  it('includes interior gap columns in the highlighted band', () => {
    // ungapped "AC" at aligned cols 0 and 2 → band [0,3) spans the gap col 1.
    expect(match('AC', 'A-C')).toEqual([[0, 3]])
  })

  it('all-gap row yields no matches', () => {
    expect(match('A', '---')).toEqual([])
  })

  it('buildUngapped maps positions to aligned columns', () => {
    const { seq, colOf } = buildUngapped(row('A-CD'))
    expect(seq).toBe('ACD')
    expect(Array.from(colOf)).toEqual([0, 2, 3])
  })
})
