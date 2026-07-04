// Single source of truth for Claurdalie's categorical / brand / semantic colors.
//
// Historically the same qualitative palette was copy-pasted across GroupModel,
// StructureController, the 3D viewer, the score-track renderer and the brand
// mark — and a stray `#2bb3a3` teal drifted apart from the real accent
// (`#0d9488`). Everything now slices this one module so brand teal == accent
// teal everywhere, there is exactly one danger red, and the canvas layer (which
// needs packed 0xRRGGBB numbers) reads the same hex via `hex()`.
//
// DA note (MSA-coherent): the residue color schemes already encode meaning via
// hue on the grid; the chrome reuses the same language — teal is the accent,
// the categorical hues carry data identity (groups / tracks / chains / tree),
// neutral gray is "Others" / muted, and a single red means "destructive" only.

import { hex, type RGB } from './scheme'

/**
 * Qualitative categorical palette, ordered for maximum adjacent contrast.
 * Index 0 IS the brand accent so a "first group" reads as the brand color.
 */
export const CATEGORICAL = [
  '#0d9488', // teal   — brand accent
  '#f3a83c', // amber
  '#5b7cf0', // indigo
  '#ef5d6c', // coral
  '#8b5cf6', // violet
  '#22c55e', // green
  '#eab308', // yellow
  '#ec4899', // pink
  '#14b8a6', // teal-2
  '#f97316', // orange
] as const

/** Neutral gray for the "Others" bucket / muted data. */
export const NEUTRAL_GROUP = '#8a8a94'

/** Brand accent (teal) per theme. Matches tokens.css --accent. */
export const ACCENT_LIGHT = '#0d9488'
export const ACCENT_DARK = '#2dd4bf'

/** The single destructive/error red per theme. Matches tokens.css --danger. */
export const DANGER_LIGHT = '#dc2626'
export const DANGER_DARK = '#f87171'

/** Background of the colored-tile brand mark / favicon. */
export const BRAND_TILE_BG = '#12141c'

/** Numeric (packed 0xRRGGBB) accents for the canvas layer. */
export const ACCENT_LIGHT_RGB: RGB = hex(ACCENT_LIGHT)
export const ACCENT_DARK_RGB: RGB = hex(ACCENT_DARK)

/** Pick a categorical color by index, wrapping around. */
export function categorical(i: number): string {
  return CATEGORICAL[((i % CATEGORICAL.length) + CATEGORICAL.length) % CATEGORICAL.length]
}
