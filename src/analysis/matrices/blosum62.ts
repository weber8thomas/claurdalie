// BLOSUM62 substitution matrix + background amino-acid frequencies, remapped
// onto our residue codes (core/alphabet.ts) for O(1) score lookup.
//
// Used by the Mean-Distances conservation method (average pairwise substitution
// score per column) and by JSD (BLOSUM62 marginal frequencies as the reference
// background distribution, following Capra & Singh 2007).

import { CODE_TO_CHAR, ALPHABET_SIZE } from '../../core/alphabet'

// Standard BLOSUM62 order.
const ORDER = 'ARNDCQEGHILKMFPSTWYVBZX*'

// prettier-ignore
const RAW = [
  [ 4,-1,-2,-2, 0,-1,-1, 0,-2,-1,-1,-1,-1,-2,-1, 1, 0,-3,-2, 0,-2,-1, 0,-4],
  [-1, 5, 0,-2,-3, 1, 0,-2, 0,-3,-2, 2,-1,-3,-2,-1,-1,-3,-2,-3,-1, 0,-1,-4],
  [-2, 0, 6, 1,-3, 0, 0, 0, 1,-3,-3, 0,-2,-3,-2, 1, 0,-4,-2,-3, 3, 0,-1,-4],
  [-2,-2, 1, 6,-3, 0, 2,-1,-1,-3,-4,-1,-3,-3,-1, 0,-1,-4,-3,-3, 4, 1,-1,-4],
  [ 0,-3,-3,-3, 9,-3,-4,-3,-3,-1,-1,-3,-1,-2,-3,-1,-1,-2,-2,-1,-3,-3,-2,-4],
  [-1, 1, 0, 0,-3, 5, 2,-2, 0,-3,-2, 1, 0,-3,-1, 0,-1,-2,-1,-2, 0, 3,-1,-4],
  [-1, 0, 0, 2,-4, 2, 5,-2, 0,-3,-3, 1,-2,-3,-1, 0,-1,-3,-2,-2, 1, 4,-1,-4],
  [ 0,-2, 0,-1,-3,-2,-2, 6,-2,-4,-4,-2,-3,-3,-2, 0,-2,-2,-3,-3,-1,-2,-1,-4],
  [-2, 0, 1,-1,-3, 0, 0,-2, 8,-3,-3,-1,-2,-1,-2,-1,-2,-2, 2,-3, 0, 0,-1,-4],
  [-1,-3,-3,-3,-1,-3,-3,-4,-3, 4, 2,-3, 1, 0,-3,-2,-1,-3,-1, 3,-3,-3,-1,-4],
  [-1,-2,-3,-4,-1,-2,-3,-4,-3, 2, 4,-2, 2, 0,-3,-2,-1,-2,-1, 1,-4,-3,-1,-4],
  [-1, 2, 0,-1,-3, 1, 1,-2,-1,-3,-2, 5,-1,-3,-1, 0,-1,-3,-2,-2, 0, 1,-1,-4],
  [-1,-1,-2,-3,-1, 0,-2,-3,-2, 1, 2,-1, 5, 0,-2,-1,-1,-1,-1, 1,-3,-1,-1,-4],
  [-2,-3,-3,-3,-2,-3,-3,-3,-1, 0, 0,-3, 0, 6,-4,-2,-2, 1, 3,-1,-3,-3,-1,-4],
  [-1,-2,-2,-1,-3,-1,-1,-2,-2,-3,-3,-1,-2,-4, 7,-1,-1,-4,-3,-2,-2,-1,-2,-4],
  [ 1,-1, 1, 0,-1, 0, 0, 0,-1,-2,-2, 0,-1,-2,-1, 4, 1,-3,-2,-2, 0, 0, 0,-4],
  [ 0,-1, 0,-1,-1,-1,-1,-2,-2,-1,-1,-1,-1,-2,-1, 1, 5,-2,-2, 0,-1,-1, 0,-4],
  [-3,-3,-4,-4,-2,-2,-3,-2,-2,-3,-2,-3,-1, 1,-4,-3,-2,11, 2,-3,-4,-3,-2,-4],
  [-2,-2,-2,-3,-2,-1,-2,-3, 2,-1,-1,-2,-1, 3,-3,-2,-2, 2, 7,-1,-3,-2,-1,-4],
  [ 0,-3,-3,-3,-1,-2,-2,-3,-3, 3, 1,-2, 1,-1,-2,-2, 0,-3,-1, 4,-3,-2,-1,-4],
  [-2,-1, 3, 4,-3, 0, 1,-1, 0,-3,-4, 0,-3,-3,-2, 0,-1,-4,-3,-3, 4, 1,-1,-4],
  [-1, 0, 0, 1,-3, 3, 4,-2, 0,-3,-3, 1,-1,-3,-1, 0,-1,-3,-2,-2, 1, 4,-1,-4],
  [ 0,-1,-1,-1,-2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-2, 0, 0,-2,-1,-1,-1,-1,-1,-4],
  [-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4, 1],
]

const charToBlosum = new Int16Array(128).fill(-1)
for (let i = 0; i < ORDER.length; i++) charToBlosum[ORDER.charCodeAt(i)] = i

/**
 * Code-indexed BLOSUM62: `BLOSUM62[a][b]` is the substitution score for residue
 * codes a and b. Codes with no BLOSUM entry (gap) fall back to the 'X' row/col.
 */
export const BLOSUM62: Int16Array[] = (() => {
  const xIdx = ORDER.indexOf('X')
  const codeToBlosum = new Int16Array(ALPHABET_SIZE)
  for (let code = 0; code < ALPHABET_SIZE; code++) {
    const ch = CODE_TO_CHAR[code].charCodeAt(0)
    const bi = ch < 128 ? charToBlosum[ch] : -1
    codeToBlosum[code] = bi < 0 ? xIdx : bi
  }
  const m: Int16Array[] = []
  for (let a = 0; a < ALPHABET_SIZE; a++) {
    const row = new Int16Array(ALPHABET_SIZE)
    for (let b = 0; b < ALPHABET_SIZE; b++) row[b] = RAW[codeToBlosum[a]][codeToBlosum[b]]
    m.push(row)
  }
  return m
})()

// BLOSUM62 background marginal frequencies (Capra & Singh 2007), code-indexed.
// Order matches ORDER's first 20 entries.
const BG = [
  0.078, 0.051, 0.041, 0.052, 0.024, 0.034, 0.059, 0.083, 0.025, 0.062,
  0.092, 0.056, 0.024, 0.044, 0.043, 0.059, 0.055, 0.014, 0.034, 0.072,
]
export const BLOSUM62_BACKGROUND: Float64Array = (() => {
  const t = new Float64Array(ALPHABET_SIZE)
  for (let i = 0; i < 20; i++) t[CODE_TO_CHAR.indexOf(ORDER[i])] = BG[i]
  return t
})()
