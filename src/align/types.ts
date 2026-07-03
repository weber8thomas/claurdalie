// Shared types for re-alignment.
//
// Mirrors src/structure/types.ts (StructureSource): a pluggable Aligner takes a
// set of ungapped sequences and returns a fresh gapped multiple alignment. The
// pure-WASM path (kalign via Aioli) and the network path (EMBL-EBI MAFFT) both
// implement this, so the controller/panel are agnostic to where the alignment
// is computed. Failures surface as typed AlignErrors so the UI can degrade
// gracefully (offline, CORS-blocked, oversized input, module unavailable).

export interface AlignInput {
  name: string
  /** Ungapped one-letter residues. */
  sequence: string
}

export interface AlignedSeq {
  name: string
  /** Aligned residue codes including interior gaps (see core/alphabet). */
  codes: Uint8Array
}

export interface AlignOptions {
  /** Reserved for aligner-specific tuning; kept minimal for now. */
  [key: string]: unknown
}

/** Why an alignment attempt failed — drives the panel message and retry hint. */
export type AlignErrorKind =
  | 'blocked' // network/CORS/policy denied the request
  | 'network' // transient network / endpoint failure
  | 'too-long' // exceeds the aligner's sequence-count cap
  | 'unavailable' // the aligner's module/CDN could not be loaded

export class AlignError extends Error {
  constructor(
    readonly kind: AlignErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'AlignError'
  }
}

/**
 * A pluggable multiple-sequence aligner. `align` rejects with an AlignError.
 * `onProgress` receives coarse status strings for the panel's busy line.
 */
export interface Aligner {
  readonly id: string
  readonly label: string
  /** True if `align` makes a network request (gates the offline/blocked UX). */
  readonly needsNetwork: boolean
  /** Largest number of sequences this aligner accepts, or null for unbounded. */
  readonly maxSequences: number | null
  align(
    seqs: AlignInput[],
    opts?: AlignOptions,
    signal?: AbortSignal,
    onProgress?: (message: string) => void,
  ): Promise<AlignedSeq[]>
}
