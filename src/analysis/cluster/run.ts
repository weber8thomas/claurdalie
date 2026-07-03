// Orchestrates one clustering run: pick the representation the chosen method
// needs (distance matrix vs. feature vectors) from the selected criteria, run
// the method, and map results back to full-alignment row order. Pure and
// worker-safe.

import { identityDistance, euclideanDistance, type GapHandling } from './distance'
import { buildFeatureMatrix } from './criteria'
import { autoKmeans, autoMixture, hierarchic, dpc, type ClusterOutcome } from './methods'
import { CLUSTER_METHODS, type ClusterCriterionId, type ClusterMethodId } from './types'

export interface ClusterRunOptions {
  criteria: ClusterCriterionId[]
  method: ClusterMethodId
  zones: [number, number][]
  gap: GapHandling
  /** Row indices to cluster; the rest become the "Others" group. */
  subset?: number[]
}

export interface ClusterRunResult {
  /** cluster index per ROW (0..k-1); "Others" rows get index k. */
  assignments: number[]
  k: number
  hasOthers: boolean
}

const MIN_SEQS = 4

export function runClustering(rows: Uint8Array[], width: number, opts: ClusterRunOptions): ClusterRunResult {
  const n = rows.length
  const idx = opts.subset && opts.subset.length > 0 ? opts.subset.slice() : Array.from({ length: n }, (_, i) => i)
  const others = opts.subset && opts.subset.length > 0 ? Array.from({ length: n }, (_, i) => i).filter((i) => !idx.includes(i)) : []

  const full = new Array(n).fill(0)
  if (idx.length < MIN_SEQS) {
    // Too few to cluster meaningfully — one group (+ Others if any).
    for (const o of others) full[o] = 1
    return { assignments: full, k: 1, hasOthers: others.length > 0 }
  }

  const subRows = idx.map((i) => rows[i])
  const methodInfo = CLUSTER_METHODS.find((m) => m.id === opts.method)!
  const outcome = methodInfo.input === 'distance'
    ? clusterByDistance(subRows, width, opts)
    : clusterByVector(subRows, opts)

  idx.forEach((row, i) => (full[row] = outcome.assignments[i]))
  const k = outcome.k
  for (const o of others) full[o] = k // Others bucket after the real clusters
  return { assignments: full, k, hasOthers: others.length > 0 }
}

function clusterByDistance(subRows: Uint8Array[], width: number, opts: ClusterRunOptions): ClusterOutcome {
  // Identity distance when identity is chosen (or no vector criterion given);
  // otherwise Euclidean over the feature vectors.
  const hasVector = opts.criteria.some((c) => c === 'length' || c === 'hydrophobicity' || c === 'pI' || c === 'composition')
  let D: Float64Array[]
  if (opts.criteria.includes('identity') || !hasVector) {
    D = identityDistance(subRows, width, opts.gap, opts.zones)
  } else {
    const { vectors } = buildFeatureMatrix(subRows.map((codes) => ({ codes })), opts.criteria)
    D = euclideanDistance(vectors)
  }
  return opts.method === 'dpc' ? dpc(D) : hierarchic(D)
}

function clusterByVector(subRows: Uint8Array[], opts: ClusterRunOptions): ClusterOutcome {
  let { vectors, dims } = buildFeatureMatrix(subRows.map((codes) => ({ codes })), opts.criteria)
  if (dims === 0) {
    // Vector method chosen with only identity/categorical criteria — fall back
    // to amino-acid composition so k-means/mixture still have something to fit.
    ;({ vectors } = buildFeatureMatrix(subRows.map((codes) => ({ codes })), ['composition']))
  }
  if (opts.method === 'kmeans') return autoKmeans(vectors)
  return autoMixture(vectors, opts.method === 'mixtureAIC' ? 'aic' : 'bic')
}
