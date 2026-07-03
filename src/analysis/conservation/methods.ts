// Conservation scoring methods. Each maps a column's residue-code counts to a
// score in 0..100 (100 = fully conserved), or NaN when the column has too few
// residues to score. All are pure functions of the counts — no alignment access
// — so they run identically on the main thread and in the numerics worker.
//
// Distributions are taken over the 20 canonical amino acids (codes 1..20).
// `total` from the counter is the non-gap count (may include ambiguity codes);
// we recompute the canonical total per method where a distribution is needed.

import { ALPHABET_SIZE } from '../../core/alphabet'
import { BLOSUM62, BLOSUM62_BACKGROUND } from '../matrices/blosum62'
import { VOLUME_POLARITY_VECTORS } from '../matrices/properties'
import type { ColumnInput, ConservationMethodId } from './types'

const LOG2 = Math.log(2)
const MAX_ENTROPY = Math.log(20) / LOG2 // log2(20)
const AA_LO = 1
const AA_HI = 20 // inclusive

/** Minimum non-gap residues Ordalie's "automatic" methods require to score. */
export const MIN_RESIDUES = 6 // "more than five residues"

function canonicalTotal(counts: Uint16Array): number {
  let n = 0
  for (let c = AA_LO; c <= AA_HI; c++) n += counts[c]
  return n
}

function clamp100(x: number): number {
  return x < 0 ? 0 : x > 100 ? 100 : x
}

// ---- individual methods --------------------------------------------------

/** Consensus (most-frequent-residue) fraction × 100. */
export function threshold(col: ColumnInput): number {
  const n = canonicalTotal(col.counts)
  if (n === 0) return NaN
  let best = 0
  for (let c = AA_LO; c <= AA_HI; c++) if (col.counts[c] > best) best = col.counts[c]
  return (best / n) * 100
}

/** 1 − normalized Shannon entropy. */
export function shannon(col: ColumnInput): number {
  const n = canonicalTotal(col.counts)
  if (n === 0) return NaN
  let h = 0
  for (let c = AA_LO; c <= AA_HI; c++) {
    const k = col.counts[c]
    if (k === 0) continue
    const p = k / n
    h -= p * (Math.log(p) / LOG2)
  }
  return clamp100((1 - h / MAX_ENTROPY) * 100)
}

/** Jensen-Shannon divergence of the column vs. the BLOSUM62 background. */
export function jsd(col: ColumnInput): number {
  const n = canonicalTotal(col.counts)
  if (n === 0) return NaN
  let div = 0
  for (let c = AA_LO; c <= AA_HI; c++) {
    const p = col.counts[c] / n
    const q = BLOSUM62_BACKGROUND[c]
    const m = (p + q) / 2
    if (m <= 0) continue
    if (p > 0) div += 0.5 * p * (Math.log(p / m) / LOG2)
    if (q > 0) div += 0.5 * q * (Math.log(q / m) / LOG2)
  }
  return clamp100(div * 100) // JSD (base-2) is bounded in [0,1]
}

const MEANDIST_FLOOR = -4 // BLOSUM62 practical minimum

/** Average pairwise BLOSUM62 score, normalized against the all-identical ideal. */
export function meanDistance(col: ColumnInput): number {
  const n = canonicalTotal(col.counts)
  if (n < 2) return n === 1 ? 100 : NaN
  // Sum of pairwise scores using counts: Σ_{a<=b} c_a·c_b·S(a,b), then subtract
  // the self-pairs and halve. Also accumulate the ideal (diagonal) sum.
  let pairSum = 0
  let idealSum = 0
  for (let a = AA_LO; a <= AA_HI; a++) {
    const ca = col.counts[a]
    if (ca === 0) continue
    // pairs within the same residue: C(ca,2) · S(a,a)
    pairSum += ((ca * (ca - 1)) / 2) * BLOSUM62[a][a]
    idealSum += ((ca * (ca - 1)) / 2) * BLOSUM62[a][a]
    for (let b = a + 1; b <= AA_HI; b++) {
      const cb = col.counts[b]
      if (cb === 0) continue
      pairSum += ca * cb * BLOSUM62[a][b]
      // ideal treats every residue as its own best self-score
      idealSum += ca * cb * ((BLOSUM62[a][a] + BLOSUM62[b][b]) / 2)
    }
  }
  const nPairs = (n * (n - 1)) / 2
  const avg = pairSum / nPairs
  const ideal = idealSum / nPairs
  const denom = ideal - MEANDIST_FLOOR
  if (denom <= 0) return NaN
  return clamp100(((avg - MEANDIST_FLOOR) / denom) * 100)
}

/**
 * Vector Norm (Ordalie proprietary): project residues into z-scored
 * volume/polarity space; score = (nc/nt)·|Σvᵢ|/Σ|vᵢ|. High when residues share
 * physical constraints (vectors reinforce), low when diverse (vectors cancel).
 */
export function vectorNorm(col: ColumnInput, nSeq: number): number {
  const { vectors, dims } = VOLUME_POLARITY_VECTORS
  const sum = new Float64Array(dims)
  let sumMag = 0
  let nc = 0
  for (let c = AA_LO; c <= AA_HI; c++) {
    const k = col.counts[c]
    if (k === 0) continue
    const v = vectors[c]
    if (!v) continue
    nc += k
    let mag = 0
    for (let d = 0; d < dims; d++) {
      sum[d] += k * v[d]
      mag += v[d] * v[d]
    }
    sumMag += k * Math.sqrt(mag)
  }
  if (nc === 0 || sumMag === 0) return NaN
  let sumNorm = 0
  for (let d = 0; d < dims; d++) sumNorm += sum[d] * sum[d]
  sumNorm = Math.sqrt(sumNorm)
  const nt = nSeq > 0 ? nSeq : nc
  return clamp100((nc / nt) * (sumNorm / sumMag) * 100)
}

/**
 * BILD-style Bayesian score: log-odds of the column counts under a background-
 * shaped Dirichlet prior vs. the background itself, via the Dirichlet-multinomial
 * marginal likelihood. A single-component simplification of Altschul et al.'s
 * Dirichlet-mixture BILD — robust for small columns, monotonic with conservation.
 */
const BILD_CONCENTRATION = 1 // total prior pseudocounts
export function bild(col: ColumnInput): number {
  const n = canonicalTotal(col.counts)
  if (n === 0) return NaN
  // log P(counts | Dirichlet(α)) − log P(counts | background multinomial)
  let logNum = lgamma(BILD_CONCENTRATION) - lgamma(n + BILD_CONCENTRATION)
  let logDen = 0
  for (let c = AA_LO; c <= AA_HI; c++) {
    const k = col.counts[c]
    const alpha = BILD_CONCENTRATION * BLOSUM62_BACKGROUND[c]
    logNum += lgamma(k + alpha) - lgamma(alpha)
    if (k > 0) logDen += k * Math.log(BLOSUM62_BACKGROUND[c])
  }
  const bits = (logNum - logDen) / LOG2
  // Normalize by the maximum achievable (all n in the rarest background residue).
  const minBg = Math.min(...Array.from({ length: 20 }, (_, i) => BLOSUM62_BACKGROUND[i + 1]))
  const maxBits = -n * Math.log(minBg) / LOG2
  return clamp100((bits / maxBits) * 100)
}

/**
 * Liu: similarity-weighted entropy. Standard Shannon over-penalizes conservative
 * substitutions; here each residue's effective frequency is smeared over
 * biochemically similar residues (positive BLOSUM62), so a column of similar
 * residues reads as more conserved than a column of dissimilar ones.
 */
export function liu(col: ColumnInput): number {
  const n = canonicalTotal(col.counts)
  if (n === 0) return NaN
  // Smoothed distribution p'_a ∝ Σ_b p_b · max(0, S(a,b)).
  const p = new Float64Array(ALPHABET_SIZE)
  for (let c = AA_LO; c <= AA_HI; c++) p[c] = col.counts[c] / n
  const sm = new Float64Array(ALPHABET_SIZE)
  let smTotal = 0
  for (let a = AA_LO; a <= AA_HI; a++) {
    let acc = 0
    for (let b = AA_LO; b <= AA_HI; b++) {
      if (p[b] === 0) continue
      const s = BLOSUM62[a][b]
      if (s > 0) acc += p[b] * s
    }
    sm[a] = acc
    smTotal += acc
  }
  if (smTotal === 0) return shannon(col) // no positive similarity: fall back
  let h = 0
  for (let a = AA_LO; a <= AA_HI; a++) {
    if (sm[a] === 0) continue
    const pa = sm[a] / smTotal
    h -= pa * (Math.log(pa) / LOG2)
  }
  return clamp100((1 - h / MAX_ENTROPY) * 100)
}

// ---- registry ------------------------------------------------------------

export type ScoreFn = (col: ColumnInput, nSeq: number) => number

/** The single-pass (non-meta) methods, keyed by id. */
export const SCORE_FNS: Record<Exclude<ConservationMethodId, 'multi'>, ScoreFn> = {
  threshold: (c) => threshold(c),
  shannon: (c) => shannon(c),
  jsd: (c) => jsd(c),
  meanDistance: (c) => meanDistance(c),
  vectorNorm: (c, n) => vectorNorm(c, n),
  bild: (c) => bild(c),
  liu: (c) => liu(c),
}

/** Multi: mean of the other methods' scores for the column (ignoring NaN). */
export function multi(col: ColumnInput, nSeq: number): number {
  let sum = 0
  let k = 0
  for (const id of Object.keys(SCORE_FNS) as Exclude<ConservationMethodId, 'multi'>[]) {
    const s = SCORE_FNS[id](col, nSeq)
    if (!Number.isNaN(s)) {
      sum += s
      k++
    }
  }
  return k === 0 ? NaN : sum / k
}

export function scoreColumn(method: ConservationMethodId, col: ColumnInput, nSeq: number): number {
  return method === 'multi' ? multi(col, nSeq) : SCORE_FNS[method](col, nSeq)
}

// ---- lgamma (Lanczos) ----------------------------------------------------

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
]
function lgamma(x: number): number {
  if (x <= 0) return Infinity
  let g = 0.99999999999980993
  const xm1 = x - 1
  for (let i = 0; i < LANCZOS.length; i++) g += LANCZOS[i] / (xm1 + i + 1)
  const t = xm1 + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (xm1 + 0.5) * Math.log(t) - t + Math.log(g)
}
