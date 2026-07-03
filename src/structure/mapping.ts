// Bidirectional map between alignment columns and structure residues for one
// reference row.
//
// A folded structure is indexed by *ungapped* residue position; the alignment
// grid is indexed by *column*. Hovering a column must highlight the right
// residue in 3D, and clicking a residue must jump the alignment cursor to the
// right column. This precomputes both directions in O(width).
//
// IMPORTANT: unlike the fold cache (keyed by sequence content, stable across
// gap edits), this map is only valid for a specific gap layout and MUST be
// rebuilt whenever the reference row's gaps move.

import { GAP_CODE } from '../core/alphabet'

export class ResidueColumnMap {
  /** columnToResidue[col] = 1-based ungapped residue index, or 0 at a gap. */
  private readonly columnToResidue: Int32Array
  /** residueToColumn[residue] = column; index 0 is unused (residues are 1-based). */
  private readonly residueToColumn: Int32Array
  readonly residueCount: number

  private constructor(c2r: Int32Array, r2c: Int32Array, residueCount: number) {
    this.columnToResidue = c2r
    this.residueToColumn = r2c
    this.residueCount = residueCount
  }

  /** Build from a full-width row of residue codes (gap = 0). */
  static build(codes: Uint8Array): ResidueColumnMap {
    const width = codes.length
    const c2r = new Int32Array(width)
    let residue = 0
    for (let col = 0; col < width; col++) {
      if (codes[col] === GAP_CODE) {
        c2r[col] = 0
      } else {
        residue++
        c2r[col] = residue
      }
    }
    const r2c = new Int32Array(residue + 1).fill(-1)
    for (let col = 0; col < width; col++) {
      const r = c2r[col]
      if (r > 0 && r2c[r] === -1) r2c[r] = col
    }
    return new ResidueColumnMap(c2r, r2c, residue)
  }

  /** 0-based residue index at a column, or null if the column is a gap / OOB. */
  residueAtColumn(col: number): number | null {
    if (col < 0 || col >= this.columnToResidue.length) return null
    const r = this.columnToResidue[col]
    return r === 0 ? null : r - 1
  }

  /** Column for a 0-based residue index, or null if out of range. */
  columnOfResidue(residueIndex: number): number | null {
    const r = residueIndex + 1
    if (r < 1 || r > this.residueCount) return null
    const col = this.residueToColumn[r]
    return col < 0 ? null : col
  }
}
