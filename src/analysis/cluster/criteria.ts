// Per-sequence feature vectors for the vector-based clustering criteria
// (length, hydrophobicity, pI, aa-composition). The identity criterion is
// distance-based (see distance.ts) and life-domain is categorical, so neither
// appears here. Vectors are z-scored per dimension across the sequence set so
// no single criterion dominates by scale.

import { CODE_TO_CHAR } from '../../core/alphabet'
import { HYDROPATHY, isoelectricPoint } from '../matrices/properties'
import type { ClusterCriterionId } from './types'

const AA_LO = 1
const AA_HI = 20

interface SeqCodes {
  codes: Uint8Array // aligned codes (gaps included)
}

/** Non-gap canonical residue counts, keyed by one-letter char. */
function residueCounts(codes: Uint8Array): { counts: Record<string, number>; total: number } {
  const counts: Record<string, number> = {}
  let total = 0
  for (const code of codes) {
    if (code >= AA_LO && code <= AA_HI) {
      const ch = CODE_TO_CHAR[code]
      counts[ch] = (counts[ch] ?? 0) + 1
      total++
    }
  }
  return { counts, total }
}

/** Raw feature vector for one sequence given the selected vector criteria. */
function rawFeatures(seq: SeqCodes, criteria: ClusterCriterionId[]): number[] {
  const { counts, total } = residueCounts(seq.codes)
  const out: number[] = []
  for (const c of criteria) {
    if (c === 'length') {
      out.push(total)
    } else if (c === 'hydrophobicity') {
      let sum = 0
      let n = 0
      for (let code = AA_LO; code <= AA_HI; code++) {
        const ch = CODE_TO_CHAR[code]
        const k = counts[ch] ?? 0
        if (k && !Number.isNaN(HYDROPATHY[code])) {
          sum += k * HYDROPATHY[code]
          n += k
        }
      }
      out.push(n > 0 ? sum / n : 0)
    } else if (c === 'pI') {
      out.push(total > 0 ? isoelectricPoint(counts) : 7)
    } else if (c === 'composition') {
      for (let code = AA_LO; code <= AA_HI; code++) {
        const ch = CODE_TO_CHAR[code]
        out.push(total > 0 ? (counts[ch] ?? 0) / total : 0)
      }
    }
  }
  return out
}

/**
 * Build a z-scored feature matrix (one vector per sequence) for the selected
 * vector criteria. `identity`/`lifeDomain` are ignored here.
 */
export function buildFeatureMatrix(
  seqs: SeqCodes[],
  criteria: ClusterCriterionId[],
): { vectors: Float64Array[]; dims: number } {
  const vectorCriteria = criteria.filter((c) => c === 'length' || c === 'hydrophobicity' || c === 'pI' || c === 'composition')
  if (vectorCriteria.length === 0 || seqs.length === 0) return { vectors: seqs.map(() => new Float64Array(0)), dims: 0 }

  const raw = seqs.map((s) => rawFeatures(s, vectorCriteria))
  const dims = raw[0].length
  const means = new Float64Array(dims)
  const sds = new Float64Array(dims)
  for (let d = 0; d < dims; d++) {
    let sum = 0
    for (const r of raw) sum += r[d]
    const mean = sum / raw.length
    let varSum = 0
    for (const r of raw) varSum += (r[d] - mean) ** 2
    means[d] = mean
    sds[d] = Math.sqrt(varSum / raw.length) || 1
  }
  const vectors = raw.map((r) => {
    const v = new Float64Array(dims)
    for (let d = 0; d < dims; d++) v[d] = (r[d] - means[d]) / sds[d]
    return v
  })
  return { vectors, dims }
}
