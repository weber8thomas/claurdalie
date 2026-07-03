// Per-residue physico-chemical property tables, code-indexed for O(1) lookup.
//
// These feed the Vector Norm conservation method (volume/polarity space) and,
// later, the clustering criteria (pI, composition). Values are the widely-cited
// literature sets; each table is indexed by residue code (see core/alphabet.ts),
// so index 0 (gap) and the ambiguity/stop codes are left as NaN / 0.

import { CODE_TO_CHAR } from '../../core/alphabet'

/** Build a code-indexed Float64 table from a one-letter map; missing → NaN. */
function codeTable(map: Record<string, number>): Float64Array {
  const t = new Float64Array(CODE_TO_CHAR.length).fill(NaN)
  for (let code = 0; code < CODE_TO_CHAR.length; code++) {
    const v = map[CODE_TO_CHAR[code]]
    if (v !== undefined) t[code] = v
  }
  return t
}

// Mean residue volumes, Å³ (Zamyatnin, 1972).
export const VOLUME = codeTable({
  A: 88.6, R: 173.4, N: 114.1, D: 111.1, C: 108.5, Q: 143.8, E: 138.4, G: 60.1,
  H: 153.2, I: 166.7, L: 166.7, K: 168.6, M: 162.9, F: 189.9, P: 112.7, S: 89.0,
  T: 116.1, W: 227.8, Y: 193.6, V: 140.0,
})

// Polarity (Grantham, 1974).
export const POLARITY = codeTable({
  A: 8.1, R: 10.5, N: 11.6, D: 13.0, C: 5.5, Q: 10.5, E: 12.3, G: 9.0, H: 10.4,
  I: 5.2, L: 4.9, K: 11.3, M: 5.7, F: 5.2, P: 8.0, S: 9.2, T: 8.6, W: 5.4,
  Y: 6.2, V: 5.9,
})

// Kyte-Doolittle hydropathy (mirrors the gradient used in color/schemes.ts).
export const HYDROPATHY = codeTable({
  I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7,
  S: -0.8, W: -0.9, Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5,
  N: -3.5, K: -3.9, R: -4.5,
})

/**
 * Z-scored (mean 0, unit variance across the 20 AAs) property vectors used by
 * the Vector Norm method. Centering matters: raw volume/polarity are all
 * positive, so summed vectors could never cancel and the score would never
 * approach 0. After centering, a column of biochemically diverse residues
 * yields vectors pointing in opposing directions that partially cancel, so
 * `|Σv| / Σ|v|` drops — exactly the "shared physical constraint" signal the
 * method is meant to capture.
 */
export interface PropertyVectors {
  /** code → [z(volume), z(polarity)], or null for non-standard residues. */
  vectors: (Float64Array | null)[]
  dims: number
}

function zscore(tables: Float64Array[]): PropertyVectors {
  const n = CODE_TO_CHAR.length
  const means: number[] = []
  const sds: number[] = []
  for (const t of tables) {
    let sum = 0
    let cnt = 0
    for (let c = 1; c <= 20; c++) {
      if (!Number.isNaN(t[c])) {
        sum += t[c]
        cnt++
      }
    }
    const mean = sum / cnt
    let varsum = 0
    for (let c = 1; c <= 20; c++) if (!Number.isNaN(t[c])) varsum += (t[c] - mean) ** 2
    means.push(mean)
    sds.push(Math.sqrt(varsum / cnt) || 1)
  }
  const vectors: (Float64Array | null)[] = new Array(n).fill(null)
  for (let code = 1; code < n; code++) {
    let ok = true
    const v = new Float64Array(tables.length)
    for (let d = 0; d < tables.length; d++) {
      const raw = tables[d][code]
      if (Number.isNaN(raw)) {
        ok = false
        break
      }
      v[d] = (raw - means[d]) / sds[d]
    }
    vectors[code] = ok ? v : null
  }
  return { vectors, dims: tables.length }
}

/** The default Vector Norm space: z-scored volume × polarity (VRP-like). */
export const VOLUME_POLARITY_VECTORS = zscore([VOLUME, POLARITY])
