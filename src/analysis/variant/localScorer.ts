// Default LOCAL mutation-effect scorer — pure, deterministic, offline.
//
// It combines two signals a biologist reasons about when judging a point
// substitution:
//   1. how *chemically* radical the swap is — the BLOSUM62 substitution score
//      (conservative swaps like I→V score high/positive; radical ones like
//      W→G score low/negative);
//   2. how *conserved* the column is — a highly-conserved column amplifies the
//      impact of any non-conservative change, while a variable column dampens it.
//
// A substitution alone contributes at most ~0.35 of the impact; conservation
// scales the total up to 1.0. Everything is read from the VariantContext the
// app already computed (conservation tracks + per-column stats), so the scorer
// stays cheap, consistent with what the user sees, and needs no network.

import { charCodeToResidue, GAP_CODE, residueChar } from '../../core/alphabet'
import { BLOSUM62 } from '../matrices/blosum62'
import {
  conservationAt,
  type Variant,
  type VariantContext,
  type VariantEffectSource,
  type VariantScore,
} from './types'

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/** One-letter char → residue code (gap for '-'/'.'/'~'; unknown → X). */
function codeOf(ch: string | undefined): number {
  if (!ch) return GAP_CODE
  return charCodeToResidue(ch.charCodeAt(0))
}

/**
 * Score a single already-mapped variant. `column` is the alignment column the
 * variant maps to (null if unmappable). Exposed for direct unit testing.
 */
export function scoreVariant(variant: Variant, column: number | null, ctx: VariantContext): VariantScore {
  if (column == null) {
    return { variant, column: null, score: 0, confidence: 0, note: 'position not mapped to a column' }
  }

  const stats = ctx.columnStats(column)
  // Reference residue: the stated wild-type, else the column consensus.
  const fromCode = variant.from ? codeOf(variant.from) : stats.consensus
  const toCode = codeOf(variant.to)
  const fromCh = residueChar(fromCode)
  const toCh = variant.to === '-' ? '-' : residueChar(toCode)

  const cons = conservationAt(ctx, column) // 0..100
  const consW = cons / 100

  // Substitution penalty in 0..1 (0 = benign / no change, 1 = maximally radical).
  let subPen: number
  let subNote: string
  if (toCode === GAP_CODE) {
    // A deletion removes the residue entirely — treat as severe, scaled by conservation.
    subPen = 0.9
    subNote = `${fromCh}→gap deletion`
  } else if (toCode === fromCode) {
    subPen = 0
    subNote = 'synonymous (no residue change)'
  } else {
    const sub = BLOSUM62[fromCode][toCode] // ~ +4 (conservative) .. -4 (radical)
    subPen = clamp((4 - sub) / 8, 0, 1)
    const kind = sub >= 1 ? 'conservative' : sub <= -2 ? 'radical' : 'moderate'
    subNote = `${fromCh}→${toCh} ${kind} (BLOSUM ${sub >= 0 ? '+' : ''}${sub})`
  }

  // Radical change alone caps at 0.35; conservation amplifies to 1.0.
  const score01 = subPen * (0.35 + 0.65 * consW)
  const score = clamp(Math.round(score01 * 100), 0, 100)

  const note = `conserved ${Math.round(cons)} · ${subNote}`
  return { variant, column, score, confidence: consW, note }
}

/**
 * The local scorer as a VariantEffectSource. The model resolves each variant's
 * column before calling, and threads it through the `variant`'s presence in the
 * batch; here we re-map per variant via the context's structure map when given,
 * otherwise expect the model to have set columns (see VariantModel).
 */
export const LOCAL_SCORER: VariantEffectSource = {
  id: 'local',
  label: 'Local (BLOSUM × conservation)',
  needsNetwork: false,
  maxVariants: null,
  async score(variants, ctx, _signal): Promise<VariantScore[]> {
    return variants.map((v) => {
      // Prefer the structure map if the context is anchored to one; the model
      // otherwise supplies the column via a per-sequence map (passed as ctx.map).
      const column = ctx.map ? ctx.map.columnOfResidue(v.position - 1) : null
      return scoreVariant(v, column, ctx)
    })
  },
}
