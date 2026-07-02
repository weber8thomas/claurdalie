// Amino-acid alphabet and residue-code encoding.
//
// Residues are stored as small integer codes in typed arrays. Code 0 is the
// gap, so a freshly-zeroed buffer is "all gaps". The canonical 20 amino acids
// come first, followed by ambiguity codes and the stop symbol.

export const GAP_CODE = 0
export const GAP_CHAR = '-'

// Order matters: index === residue code. Index 0 is the gap.
const RESIDUE_CHARS =
  GAP_CHAR + // 0 gap
  'ACDEFGHIKLMNPQRSTVWY' + // 1..20 canonical amino acids
  'BZXUO' + // 21..25 ambiguity / non-standard (Asx, Glx, any, Sec, Pyl)
  '*' // 26 stop

/** Total number of distinct codes (including gap). */
export const ALPHABET_SIZE = RESIDUE_CHARS.length

/** code -> uppercase character */
export const CODE_TO_CHAR: string[] = RESIDUE_CHARS.split('')

/** char -> code, for both upper and lower case. Unknown chars map to X. */
const CHAR_TO_CODE = new Int16Array(128).fill(-1)
for (let code = 0; code < RESIDUE_CHARS.length; code++) {
  const ch = RESIDUE_CHARS.charCodeAt(code)
  CHAR_TO_CODE[ch] = code
  // lowercase alias
  const lower = RESIDUE_CHARS[code].toLowerCase().charCodeAt(0)
  if (lower < 128) CHAR_TO_CODE[lower] = code
}
// Common alternative gap characters.
CHAR_TO_CODE['.'.charCodeAt(0)] = GAP_CODE
CHAR_TO_CODE['~'.charCodeAt(0)] = GAP_CODE

const X_CODE = RESIDUE_CHARS.indexOf('X')

/** Map a single character (its char code) to a residue code. */
export function charCodeToResidue(charCode: number): number {
  if (charCode < 0 || charCode >= 128) return X_CODE
  const code = CHAR_TO_CODE[charCode]
  return code < 0 ? X_CODE : code
}

/** True if a residue code is a gap. */
export function isGap(code: number): boolean {
  return code === GAP_CODE
}

/** The canonical amino-acid codes (excludes gap, ambiguity, stop). */
export const AMINO_ACID_CODES: number[] = (() => {
  const codes: number[] = []
  for (let c = 1; c <= 20; c++) codes.push(c)
  return codes
})()

/** Convenience: character for a code (defensive against out-of-range). */
export function residueChar(code: number): string {
  return CODE_TO_CHAR[code] ?? 'X'
}
