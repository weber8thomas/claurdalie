// Types for the conservation analysis layer.

export type ConservationMethodId =
  | 'threshold'
  | 'shannon'
  | 'jsd'
  | 'meanDistance'
  | 'vectorNorm'
  | 'bild'
  | 'liu'
  | 'multi'

export interface ConservationMethodInfo {
  id: ConservationMethodId
  label: string
  /** One-line description for the UI. */
  blurb: string
}

/** Per-column input: residue-code counts and the non-gap total. */
export interface ColumnInput {
  counts: Uint16Array
  total: number
}

/**
 * A computed conservation track: one score per alignment column, normalized to
 * 0..100 (100 = fully conserved). NaN marks a column with too few residues to
 * score (fewer than the method's minimum).
 */
export interface ScoreTrack {
  method: ConservationMethodId
  /** length === alignment width at compute time. */
  scores: Float32Array
  /** Optional per-column conservation label (from the "automatic" step). */
  labels?: Uint8Array // 0 none, 1 globally conserved, 2 strictly conserved
  /** Optional per-group scores (same method, restricted to each group's rows). */
  groupScores?: { id: number; scores: Float32Array }[]
}

export const METHODS: ConservationMethodInfo[] = [
  { id: 'threshold', label: 'Threshold (identity)', blurb: 'Consensus frequency per column.' },
  { id: 'shannon', label: 'Shannon entropy', blurb: 'Information-theoretic variability (inverted).' },
  { id: 'jsd', label: 'Jensen-Shannon', blurb: 'Divergence from the BLOSUM62 background.' },
  { id: 'meanDistance', label: 'Mean distances (ClustalX)', blurb: 'Average pairwise BLOSUM62 score.' },
  { id: 'vectorNorm', label: 'Vector norm', blurb: 'Consensus in volume/polarity space.' },
  { id: 'bild', label: 'BILD', blurb: 'Bayesian log-likelihood vs. background.' },
  { id: 'liu', label: 'Liu', blurb: 'Similarity-weighted entropy.' },
  { id: 'multi', label: 'Multi (consensus)', blurb: 'Mean of the other methods.' },
]
