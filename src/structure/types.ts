// Shared types for the 3D structure / folding feature.
//
// A `Structure` is the model-level result of folding (or loading) one sequence:
// the atomic coordinates as PDB text plus a per-residue confidence track
// (pLDDT, 0..100) when the source provides one. It is deliberately viewer-
// agnostic — the React panel hands it to whatever `StructureViewer` is loaded.

export interface Structure {
  /** Atomic coordinates in PDB format. */
  pdb: string
  /**
   * Per-residue confidence (pLDDT, 0..100), indexed 0-based by residue order,
   * or null for a residue with no score. Empty when the source has no scores.
   */
  plddt: (number | null)[]
  /** Number of residues (Cα atoms) in the model. */
  residueCount: number
  /** Human label for provenance (e.g. "ESMFold", "uploaded 1abc.pdb"). */
  origin: string
}

/** Why a fold attempt failed — drives the panel's message and whether to retry. */
export type FoldErrorKind =
  | 'empty' // no residues to fold
  | 'too-long' // exceeds the source's residue cap
  | 'blocked' // network/CORS/policy denied the request
  | 'network' // transient network / endpoint failure
  | 'invalid' // endpoint returned something unusable

export class FoldError extends Error {
  constructor(
    readonly kind: FoldErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'FoldError'
  }
}

/**
 * A pluggable structure provider. The live-prediction path (ESMFold) and the
 * offline paths (uploaded PDB, AlphaFold-DB lookup) all implement this, so the
 * panel/controller are agnostic to where coordinates come from.
 */
export interface StructureSource {
  readonly id: string
  readonly label: string
  /** True if `fold` makes a network request (gates the offline/blocked UX). */
  readonly needsNetwork: boolean
  /** Largest sequence (residues) this source accepts, or null for unbounded. */
  readonly maxResidues: number | null
  /** Produce a structure for a raw one-letter sequence. Rejects with FoldError. */
  fold(sequence: string, signal?: AbortSignal): Promise<Structure>
}
