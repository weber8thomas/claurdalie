import { AMINO_ACID_CODES, CODE_TO_CHAR } from '../core/alphabet'
import type { ParsedSequence } from '../core/io/fasta'

/** Small deterministic PRNG (mulberry32) so heavy datasets are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface HeavyOptions {
  rows: number
  cols: number
  /** Probability a residue equals the column consensus (0..1). */
  conservation?: number
  /** Probability of a gap at any cell. */
  gapRate?: number
  seed?: number
}

/**
 * Generate a synthetic alignment with a controllable conservation profile and
 * gap density. Used for the "heavy" demo and the perf harness.
 */
export function generateHeavy(opts: HeavyOptions): ParsedSequence[] {
  const { rows, cols, conservation = 0.7, gapRate = 0.08, seed = 1 } = opts
  const rand = mulberry32(seed)
  const aa = AMINO_ACID_CODES

  // A consensus residue per column.
  const consensus = new Uint8Array(cols)
  for (let c = 0; c < cols; c++) consensus[c] = aa[(rand() * aa.length) | 0]

  const seqs: ParsedSequence[] = []
  for (let r = 0; r < rows; r++) {
    const codes = new Uint8Array(cols)
    for (let c = 0; c < cols; c++) {
      if (rand() < gapRate) {
        codes[c] = 0 // gap
      } else if (rand() < conservation) {
        codes[c] = consensus[c]
      } else {
        codes[c] = aa[(rand() * aa.length) | 0]
      }
    }
    seqs.push({ name: `seq_${(r + 1).toString().padStart(5, '0')}`, codes })
  }
  return seqs
}

/** Convenience: build FASTA text from generated sequences (for export/replay). */
export function heavyToFasta(seqs: ParsedSequence[]): string {
  let out = ''
  for (const s of seqs) {
    out += '>' + s.name + '\n'
    for (let i = 0; i < s.codes.length; i++) out += CODE_TO_CHAR[s.codes[i]]
    out += '\n'
  }
  return out
}
