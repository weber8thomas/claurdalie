import { CODE_TO_CHAR, GAP_CODE } from '../core/alphabet'
import {
  contrastFg,
  hex,
  lerpColor,
  type ColorContext,
  type ColorScheme,
  type RGB,
} from './scheme'

// Build a char->color map into a code-indexed lookup table.
function table(map: Record<string, string>): (RGB | null)[] {
  const t: (RGB | null)[] = new Array(CODE_TO_CHAR.length).fill(null)
  for (let code = 0; code < CODE_TO_CHAR.length; code++) {
    const ch = CODE_TO_CHAR[code]
    const c = map[ch]
    if (c) t[code] = hex(c)
  }
  return t
}

// ---- Zappo (physico-chemical property groups) ---------------------------
const ZAPPO = table({
  I: '#ffafaf', L: '#ffafaf', V: '#ffafaf', A: '#ffafaf', M: '#ffafaf', // aliphatic
  F: '#ffc800', W: '#ffc800', Y: '#ffc800', // aromatic
  K: '#6464ff', R: '#6464ff', H: '#6464ff', // positive
  D: '#ff0000', E: '#ff0000', // negative
  S: '#00ff00', T: '#00ff00', N: '#00ff00', Q: '#00ff00', // hydrophilic
  P: '#ff00ff', G: '#ff00ff', // conformationally special
  C: '#ffff00', // cysteine
})

// ---- Taylor (20 distinct colors) ----------------------------------------
const TAYLOR = table({
  A: '#ccff00', R: '#0000ff', N: '#cc00ff', D: '#ff0000', C: '#ffff00',
  Q: '#ff00cc', E: '#ff0066', G: '#ff9900', H: '#0066ff', I: '#66ff00',
  L: '#33ff00', K: '#6600ff', M: '#00ff00', F: '#00ff66', P: '#ffcc00',
  S: '#ff3300', T: '#ff6600', W: '#00ccff', Y: '#00ffcc', V: '#99ff00',
})

// ---- Clustal (group colors + dynamic consensus gating) ------------------
const CLUSTAL_COLORS = table({
  A: '#80a0f0', I: '#80a0f0', L: '#80a0f0', M: '#80a0f0', F: '#80a0f0',
  W: '#80a0f0', V: '#80a0f0', // hydrophobic
  K: '#f01505', R: '#f01505', // positive
  D: '#c048c0', E: '#c048c0', // negative
  N: '#15c015', Q: '#15c015', S: '#15c015', T: '#15c015', // polar
  C: '#f08080', // cysteine
  G: '#f09048', // glycine
  P: '#c0c000', // proline
  H: '#15a4a4', Y: '#15a4a4', // aromatic
})
// Group id per code, for consensus gating.
const CLUSTAL_GROUP: number[] = (() => {
  const groups: Record<string, number> = {
    A: 1, I: 1, L: 1, M: 1, F: 1, W: 1, V: 1,
    K: 2, R: 2,
    D: 3, E: 3,
    N: 4, Q: 4, S: 4, T: 4,
    C: 5, G: 6, P: 7,
    H: 8, Y: 8,
  }
  const g: number[] = new Array(CODE_TO_CHAR.length).fill(0)
  for (let code = 0; code < CODE_TO_CHAR.length; code++) g[code] = groups[CODE_TO_CHAR[code]] ?? 0
  return g
})()
const CLUSTAL_THRESHOLD = 0.5

// ---- Hydrophobicity gradient (Kyte-Doolittle) ---------------------------
const KD: Record<string, number> = {
  I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7,
  S: -0.8, W: -0.9, Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5,
  N: -3.5, K: -3.9, R: -4.5,
}
const RED = hex('#e0111a')
const WHITE = hex('#f4f4f4')
const BLUE = hex('#1a4fd0')
const HYDRO = ((): (RGB | null)[] => {
  const t: (RGB | null)[] = new Array(CODE_TO_CHAR.length).fill(null)
  for (let code = 1; code < CODE_TO_CHAR.length; code++) {
    const v = KD[CODE_TO_CHAR[code]]
    if (v === undefined) continue
    const s = (v + 4.5) / 9 // 0 (hydrophilic) .. 1 (hydrophobic)
    t[code] = s >= 0.5 ? lerpColor(WHITE, RED, (s - 0.5) * 2) : lerpColor(BLUE, WHITE, s * 2)
  }
  return t
})()

// ---- scheme factory -----------------------------------------------------

function staticScheme(id: string, label: string, lut: (RGB | null)[], dark: boolean): ColorScheme {
  return {
    id,
    label,
    dynamic: false,
    bg: (ctx: ColorContext) => (ctx.code === GAP_CODE ? null : lut[ctx.code] ?? null),
    fg: (ctx: ColorContext) => contrastFg(ctx.code === GAP_CODE ? null : lut[ctx.code] ?? null, dark),
  }
}

function clustalScheme(dark: boolean): ColorScheme {
  return {
    id: 'clustal',
    label: 'ClustalX (dynamic)',
    dynamic: true,
    bg: (ctx: ColorContext) => {
      if (ctx.code === GAP_CODE) return null
      const color = CLUSTAL_COLORS[ctx.code]
      if (!color) return null
      const group = CLUSTAL_GROUP[ctx.code]
      const stats = ctx.stats
      if (!stats || stats.total === 0) return null
      // Fraction of the column belonging to this residue's group.
      let inGroup = 0
      for (let c = 1; c < stats.counts.length; c++) {
        if (CLUSTAL_GROUP[c] === group) inGroup += stats.counts[c]
      }
      return inGroup / stats.total >= CLUSTAL_THRESHOLD ? color : null
    },
    fg: () => (dark ? 0xe8e8ea : 0x1a1a1e),
  }
}

const plainScheme = (dark: boolean): ColorScheme => ({
  id: 'plain',
  label: 'Plain',
  dynamic: false,
  bg: () => null,
  fg: () => (dark ? 0xd8d8dc : 0x24242a),
})

/** Build the scheme registry for a given theme (affects default text color). */
export function buildSchemes(dark: boolean): ColorScheme[] {
  return [
    clustalScheme(dark),
    staticScheme('zappo', 'Zappo', ZAPPO, dark),
    staticScheme('taylor', 'Taylor', TAYLOR, dark),
    staticScheme('hydro', 'Hydrophobicity', HYDRO, dark),
    plainScheme(dark),
  ]
}

export const DEFAULT_SCHEME_ID = 'clustal'

/** Static color lookups exposed for the legend UI. */
export const SCHEME_LUTS: Record<string, (RGB | null)[]> = {
  zappo: ZAPPO,
  taylor: TAYLOR,
  clustal: CLUSTAL_COLORS,
  hydro: HYDRO,
}
