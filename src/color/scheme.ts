import type { ColumnStats } from '../core/stats/ColumnStats'

/** Packed 0xRRGGBB color. */
export type RGB = number

export interface ColorContext {
  code: number
  col: number
  stats: ColumnStats | null
}

export interface ColorScheme {
  id: string
  label: string
  /** Needs per-column stats (consensus gating)? */
  dynamic: boolean
  /** Background color, or null for the default (transparent) background. */
  bg(ctx: ColorContext): RGB | null
  /** Foreground (text) color. */
  fg(ctx: ColorContext): RGB
}

export function rgb(r: number, g: number, b: number): RGB {
  return (r << 16) | (g << 8) | b
}

export function hex(h: string): RGB {
  return parseInt(h.replace('#', ''), 16)
}

const cssCache = new Map<RGB, string>()
export function toCss(c: RGB): string {
  let s = cssCache.get(c)
  if (!s) {
    s = '#' + c.toString(16).padStart(6, '0')
    cssCache.set(c, s)
  }
  return s
}

/** Relative luminance (0..255-ish) for choosing readable text color. */
export function luminance(c: RGB): number {
  const r = (c >> 16) & 0xff
  const g = (c >> 8) & 0xff
  const b = c & 0xff
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** Pick black or white text for contrast against a background. */
export function contrastFg(bg: RGB | null, dark: boolean): RGB {
  if (bg === null) return dark ? 0xe8e8ea : 0x1a1a1e
  return luminance(bg) > 140 ? 0x1a1a1e : 0xffffff
}

export function lerpColor(a: RGB, b: RGB, t: number): RGB {
  const ar = (a >> 16) & 0xff,
    ag = (a >> 8) & 0xff,
    ab = a & 0xff
  const br = (b >> 16) & 0xff,
    bg = (b >> 8) & 0xff,
    bb = b & 0xff
  return rgb(
    Math.round(ar + (br - ar) * t),
    Math.round(ag + (bg - ag) * t),
    Math.round(ab + (bb - ab) * t),
  )
}
