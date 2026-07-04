import { describe, it, expect } from 'vitest'
import { parseVariants, formatVariants } from './io'
import type { Variant } from './types'

describe('variants io — parseVariants', () => {
  it('parses a CSV with a header', () => {
    const text = 'seq,pos,from,to,label\nTP53,273,R,H,p.R273H\nTP53,175,R,H,'
    const { variants, errors } = parseVariants(text)
    expect(errors).toHaveLength(0)
    expect(variants).toEqual([
      { seqName: 'TP53', position: 273, from: 'R', to: 'H', label: 'p.R273H' },
      { seqName: 'TP53', position: 175, from: 'R', to: 'H', label: undefined },
    ])
  })

  it('parses a TSV (tab-delimited) without a header', () => {
    const text = 'BRCA1\t1699\tA\tV'
    const { variants, errors } = parseVariants(text)
    expect(errors).toHaveLength(0)
    expect(variants[0]).toEqual({ seqName: 'BRCA1', position: 1699, from: 'A', to: 'V', label: undefined })
  })

  it('accepts a 3-field seq,pos,to short form (no `from`)', () => {
    const { variants, errors } = parseVariants('P1,10,Q')
    expect(errors).toHaveLength(0)
    expect(variants[0]).toEqual({ seqName: 'P1', position: 10, from: undefined, to: 'Q', label: undefined })
  })

  it('joins trailing fields into the label (canonical seq,pos,from,to,label)', () => {
    const { variants, errors } = parseVariants('P1,10,A,Q,some note')
    expect(errors).toHaveLength(0)
    expect(variants[0]).toEqual({ seqName: 'P1', position: 10, from: 'A', to: 'Q', label: 'some note' })
  })

  it('skips blank and # comment lines', () => {
    const text = '# a comment\n\nP1,5,A,G\n\n'
    const { variants, errors } = parseVariants(text)
    expect(errors).toHaveLength(0)
    expect(variants).toHaveLength(1)
  })

  it('records a per-line error for a bad position but keeps good rows', () => {
    const text = 'P1,5,A,G\nP1,xx,A,G\nP1,7,A,D'
    const { variants, errors } = parseVariants(text)
    expect(variants).toHaveLength(2)
    expect(errors).toHaveLength(1)
    expect(errors[0].line).toBe(2)
    expect(errors[0].message).toMatch(/position/i)
  })

  it('records a per-line error for a non-residue alt', () => {
    const { variants, errors } = parseVariants('P1,5,A,ZZ')
    expect(variants).toHaveLength(0)
    expect(errors[0].message).toMatch(/residue/i)
  })

  it('accepts a deletion (to === "-")', () => {
    const { variants, errors } = parseVariants('P1,5,A,-')
    expect(errors).toHaveLength(0)
    expect(variants[0].to).toBe('-')
  })
})

describe('variants io — round-trip', () => {
  it('formatVariants → parseVariants is a fixed point', () => {
    const original: Variant[] = [
      { seqName: 'TP53', position: 273, from: 'R', to: 'H', label: 'p.R273H' },
      { seqName: 'seqB', position: 42, from: undefined, to: 'D', label: undefined },
      { seqName: 'seqC', position: 7, from: 'W', to: '-', label: undefined },
    ]
    const round = parseVariants(formatVariants(original)).variants
    expect(round).toEqual(original)
  })
})
