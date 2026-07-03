// Minimal PDB text parsing — just enough to drive the panel without pulling the
// (heavy) molecular viewer into non-rendering code paths.
//
// ESMFold and AlphaFold both write the per-residue pLDDT confidence into the
// B-factor column of each atom. We read it off the Cα atoms (one per residue),
// in file order, to build the confidence track and residue count. The viewer
// library does its own full parse for rendering; this is only for metadata and
// unit-testable correctness.

import type { Structure } from './types'
import { FoldError } from './types'

/** Columns are fixed-width in PDB; slice by the spec's 1-based ranges. */
function field(line: string, start: number, end: number): string {
  return line.slice(start - 1, end).trim()
}

/**
 * Extract the Cα confidence (B-factor) per residue, in file order. Returns one
 * entry per Cα atom; non-finite values become null.
 */
export function parseCaPlddt(pdb: string): (number | null)[] {
  const out: (number | null)[] = []
  for (const line of pdb.split('\n')) {
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue
    const atom = field(line, 13, 16)
    if (atom !== 'CA') continue
    const b = Number(field(line, 61, 66))
    out.push(Number.isFinite(b) ? b : null)
  }
  return out
}

/**
 * Build a Structure from raw PDB text (used by the file-upload source and to
 * wrap any source that returns PDB). Throws FoldError('invalid') if the text
 * has no Cα atoms.
 */
export function structureFromPdb(pdb: string, origin: string): Structure {
  const plddt = parseCaPlddt(pdb)
  if (plddt.length === 0) {
    throw new FoldError('invalid', 'No protein atoms (Cα) found in the structure')
  }
  return { pdb, plddt, residueCount: plddt.length, origin }
}
