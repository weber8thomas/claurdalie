import { describe, expect, it } from 'vitest'
import { CODE_TO_CHAR } from '../alphabet'
import { parseFasta, serializeFasta } from './fasta'

const toStr = (codes: Uint8Array) => Array.from(codes, (c) => CODE_TO_CHAR[c]).join('')

describe('FASTA parsing', () => {
  it('parses names and sequences', () => {
    const seqs = parseFasta('>seq1\nMKV\n>seq2\nMK-\n')
    expect(seqs.map((s) => s.name)).toEqual(['seq1', 'seq2'])
    expect(toStr(seqs[0].codes)).toBe('MKV')
    expect(toStr(seqs[1].codes)).toBe('MK-')
  })

  it('tolerates CRLF, blank lines, wrapped lines and no trailing newline', () => {
    const text = '>a\r\nMK\r\nVL\r\n\r\n>b\r\nMKVL'
    const seqs = parseFasta(text)
    expect(seqs).toHaveLength(2)
    expect(toStr(seqs[0].codes)).toBe('MKVL')
    expect(toStr(seqs[1].codes)).toBe('MKVL')
  })

  it('normalizes lowercase and dot/tilde gaps and maps unknown to X', () => {
    const seqs = parseFasta('>a\nmkv.~J\n')
    expect(toStr(seqs[0].codes)).toBe('MKV--X') // J is unknown -> X
  })

  it('round-trips through serialize/parse', () => {
    const original = '>alpha\nMKVLAGCDEFHIKLMNPQRSTVWY\n>beta\nMK--LAG-CDEF\n'
    const parsed = parseFasta(original)
    const out = serializeFasta(parsed, 60)
    const reparsed = parseFasta(out)
    expect(reparsed.map((s) => s.name)).toEqual(parsed.map((s) => s.name))
    for (let i = 0; i < parsed.length; i++) {
      expect(toStr(reparsed[i].codes)).toBe(toStr(parsed[i].codes))
    }
  })
})
