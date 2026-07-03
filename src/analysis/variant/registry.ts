// The registry of mutation-effect scorers — mirrors the color-scheme, structure-
// source, and aligner registries. Empty for now: v0.7 ships only the SEAM (types
// + registry), so a scorer (conservation-based, ESM-likelihood, etc.) can be
// dropped in later by pushing a VariantEffectSource here without touching the UI.

import type { VariantEffectSource } from './types'

export const VARIANT_SOURCES: VariantEffectSource[] = []

export function variantSourceById(id: string): VariantEffectSource | undefined {
  return VARIANT_SOURCES.find((s) => s.id === id)
}
