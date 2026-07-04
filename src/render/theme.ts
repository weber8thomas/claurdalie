import type { RGB } from '../color/scheme'
import { ACCENT_LIGHT_RGB, ACCENT_DARK_RGB } from '../color/palette'

/** Colors the canvas renderer needs (chrome pixels drawn on the canvas). */
export interface CanvasTheme {
  dark: boolean
  gridBg: RGB
  gutterBg: RGB
  rulerBg: RGB
  gridLine: RGB
  text: RGB
  mutedText: RGB
  cursor: RGB
  selection: RGB // drawn with alpha
  hover: RGB
  dropLine: RGB
}

export const LIGHT_CANVAS: CanvasTheme = {
  dark: false,
  gridBg: 0xffffff,
  gutterBg: 0xf6f7f9,
  rulerBg: 0xf6f7f9,
  gridLine: 0xe6e8ec,
  text: 0x24242a,
  mutedText: 0x8a8f98,
  cursor: ACCENT_LIGHT_RGB,
  selection: ACCENT_LIGHT_RGB,
  hover: 0x94a3b8,
  dropLine: ACCENT_LIGHT_RGB,
}

export const DARK_CANVAS: CanvasTheme = {
  dark: true,
  gridBg: 0x16171b,
  gutterBg: 0x1c1d22,
  rulerBg: 0x1c1d22,
  gridLine: 0x2a2c33,
  text: 0xd8d8dc,
  mutedText: 0x8a8f98,
  cursor: ACCENT_DARK_RGB,
  selection: ACCENT_DARK_RGB,
  hover: 0x64748b,
  dropLine: ACCENT_DARK_RGB,
}
