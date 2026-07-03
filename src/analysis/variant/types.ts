// Variant / mutation-effect SEAM — types + registry only (no scorer yet).
//
// A Variant lives on ONE sequence, addressed by a 1-based UNGAPPED residue index
// (what a biologist reads off a reference), which maps to an alignment column via
// the ResidueColumnMap (src/structure/mapping.ts). A VariantEffectSource mirrors
// StructureSource / Aligner: a pluggable provider that scores variants, given a
// VariantContext that hands it everything already computed in the app — the
// per-column conservation tracks (ConservationModel), the per-column residue
// stats (ColumnStats), and optionally a structure model + its column↔residue map.
//
// No algorithm is implemented here; this only defines the contract a future
// scorer will satisfy and the empty registry it will register into.

import type { ConservationMethodId, ScoreTrack } from '../conservation/types'
import type { ColumnStats } from '../../core/stats/ColumnStats'
import type { ResidueColumnMap } from '../../structure/mapping'

/** A point substitution/indel on a named sequence, at a 1-based ungapped index. */
export interface Variant {
  /** Sequence identity (stable across snapshot reloads — matches SnapshotSequence.name). */
  seqName: string
  /** 1-based ungapped residue index on that sequence. */
  position: number
  /** Reference (wild-type) one-letter residue, if known. */
  from?: string
  /** Alternate one-letter residue, or '-' for a deletion. */
  to: string
  /** Optional human label (e.g. "p.R273H"). */
  label?: string
}

/** Why scoring failed — mirrors StructureSource's FoldError kinds. */
export type VariantEffectKind =
  | 'unavailable' // model/module could not be loaded
  | 'network' // transient network / endpoint failure
  | 'blocked' // network/CORS/policy denied the request
  | 'too-long' // exceeds the source's variant cap
  | 'invalid' // input or response unusable

export class VariantEffectError extends Error {
  constructor(
    readonly kind: VariantEffectKind,
    message: string,
  ) {
    super(message)
    this.name = 'VariantEffectError'
  }
}

/** One scored variant. Kept deliberately open for future scorers. */
export interface VariantScore {
  variant: Variant
  /** The alignment column this variant maps to, or null if unmappable. */
  column: number | null
  /** A source-defined effect score (higher = more deleterious, by convention). */
  score: number
  /** Optional [0,1] confidence in the score. */
  confidence?: number
  /** Optional short explanation for the UI. */
  note?: string
}

/**
 * Everything a scorer is handed. It does NOT recompute conservation or stats —
 * it reads the app's already-computed tracks/stats, plus an optional structure
 * mapping, so scorers stay cheap and consistent with what the user sees.
 */
export interface VariantContext {
  /** Per-column conservation track for a method (from ConservationModel), if shown. */
  columnScores(method: ConservationMethodId): ScoreTrack | undefined
  /** Per-column residue frequencies / consensus (from the ColumnStats cache). */
  columnStats(col: number): ColumnStats
  /** Optional structure model id this context is anchored to. */
  modelId?: string
  /** Optional column↔residue map for the variant's sequence (structure-linked). */
  map?: ResidueColumnMap
}

/**
 * A pluggable mutation-effect scorer. Mirrors StructureSource: an id/label, a
 * network flag, a cap, and a score() that rejects with VariantEffectError.
 */
export interface VariantEffectSource {
  readonly id: string
  readonly label: string
  /** True if `score` makes a network request (gates the offline/blocked UX). */
  readonly needsNetwork: boolean
  /** Largest number of variants this source accepts at once, or null. */
  readonly maxVariants: number | null
  score(variants: Variant[], ctx: VariantContext, signal?: AbortSignal): Promise<VariantScore[]>
}

/**
 * Thin adapter: the alignment column for a variant, via the residue↔column map.
 * Uses the existing ResidueColumnMap (1-based ungapped index → 0-based residue →
 * column). Not a scorer — just the shared address translation.
 */
export function variantColumn(variant: Variant, map: ResidueColumnMap): number | null {
  return map.columnOfResidue(variant.position - 1)
}
