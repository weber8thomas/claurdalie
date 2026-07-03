// Turn an alignment row (integer residue codes) into a sequence a folding
// service will accept.
//
// `store.materializeRow` gives a full-width Uint8Array of residue CODES with
// gap = 0. Folding needs ungapped one-letter CHARS, and structure predictors
// only understand the 20 canonical amino acids — the alignment alphabet also
// carries B/Z/X/U/O and `*`, which must be substituted or the request is
// rejected. This module is the single place that conversion + substitution
// happens.

import { CODE_TO_CHAR, GAP_CODE } from '../core/alphabet'

/** Canonical residues a predictor accepts. */
const CANONICAL = new Set('ACDEFGHIKLMNPQRSTVWY'.split(''))

/**
 * Substitutes for non-standard codes. Ambiguity codes collapse to their most
 * common concrete residue; Sec/Pyl map to their canonical analog; anything
 * else falls back to Alanine (a neutral, small residue) rather than dropping a
 * position, so residue indices stay aligned with the source sequence.
 */
const SUBSTITUTE: Record<string, string> = {
  B: 'D', // Asx -> Asp
  Z: 'E', // Glx -> Glu
  X: 'A', // any -> Ala
  U: 'C', // Sec -> Cys
  O: 'K', // Pyl -> Lys
  '*': 'A', // stop -> Ala (defensive; usually trimmed upstream)
}

export interface FoldInput {
  /** Ungapped, canonical one-letter sequence ready to fold. */
  sequence: string
  /** Ungapped sequence before substitution (canonical + non-standard chars). */
  raw: string
  /** Number of positions that were substituted to a canonical residue. */
  substitutions: number
}

/**
 * Convert a full-width row of residue codes into a foldable sequence: strip
 * gaps, map codes to chars, and substitute non-standard residues. Residue
 * order (and therefore indexing) is preserved 1:1 with the ungapped row.
 */
export function toFoldInput(codes: Uint8Array): FoldInput {
  let raw = ''
  let sequence = ''
  let substitutions = 0
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]
    if (code === GAP_CODE) continue
    const ch = CODE_TO_CHAR[code] ?? 'X'
    raw += ch
    if (CANONICAL.has(ch)) {
      sequence += ch
    } else {
      sequence += SUBSTITUTE[ch] ?? 'A'
      substitutions++
    }
  }
  return { sequence, raw, substitutions }
}
