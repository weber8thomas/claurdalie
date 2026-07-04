// The registry of mutation-effect scorers — mirrors the color-scheme, structure-
// source, and aligner registries. The v0.7 SEAM shipped this empty; v0.9 fills it
// with the pure local scorer (default) and an optional network PLM stub. A new
// source (ESM-likelihood, ProteinGym, etc.) drops in by pushing another
// VariantEffectSource here without touching the UI.

import type { VariantEffectSource } from './types'
import { LOCAL_SCORER } from './localScorer'
import { PLM_SCORER } from './plmScorer'

/** Local (offline) first, so it is the default selection. */
export const VARIANT_SOURCES: VariantEffectSource[] = [LOCAL_SCORER, PLM_SCORER]

export function variantSourceById(id: string): VariantEffectSource | undefined {
  return VARIANT_SOURCES.find((s) => s.id === id)
}
