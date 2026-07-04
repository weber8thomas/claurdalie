// Apply a point substitution to an ungapped sequence, for "fold the mutant".
//
// A variant is addressed by a 1-based ungapped position. toFoldInput() produces
// the ungapped canonical sequence in that same 1:1 order, so a substitution is
// just a single-character replacement at position-1 — length preserved, residue
// numbering unchanged, which is exactly what lets the mutant fold be superposed
// on the wild-type fold Cα-for-Cα. Deletions/insertions are intentionally out of
// scope here (they'd break the 1:1 residue correspondence).

/** Canonical residues a structure predictor accepts. */
const CANONICAL = new Set('ACDEFGHIKLMNPQRSTVWY'.split(''))

export interface MutateResult {
  sequence: string
  /** The wild-type residue that was replaced (uppercase). */
  wild: string
}

/**
 * Replace the residue at 1-based `position` in `seq` with `alt`. Returns null if
 * the position is out of range or `alt` is not a single canonical residue (e.g.
 * a deletion '-'), which the caller surfaces as "can't fold this variant".
 */
export function applySubstitution(seq: string, position: number, alt: string): MutateResult | null {
  const i = position - 1
  if (i < 0 || i >= seq.length) return null
  const a = alt.toUpperCase()
  if (a.length !== 1 || !CANONICAL.has(a)) return null
  const wild = seq[i].toUpperCase()
  return { sequence: seq.slice(0, i) + a + seq.slice(i + 1), wild }
}
