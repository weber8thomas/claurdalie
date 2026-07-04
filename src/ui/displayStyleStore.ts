import { create } from 'zustand'
import { loadPrefs, savePrefs } from '../editor/persistence'
import type { GapGlyph } from '../render/GridRenderer'

// Customizable gap / whitespace appearance for the alignment grid. The values
// live here (persisted to prefs) and are pushed onto the GridRenderer via
// EditorController.setDisplayStyle — both on load (App seeds the renderer) and
// whenever the Display style panel changes.

export interface DisplayStyle {
  /** How gap cells render when zoomed in: nothing, a dash, or a centered dot. */
  gapGlyph: GapGlyph
  /** Fill color (hex) for gap cells, or null to keep the grid background. */
  gapFill: string | null
  /** Draw the faint per-column grid lines. */
  gridLines: boolean
}

interface DisplayStyleState extends DisplayStyle {
  setGapGlyph: (v: GapGlyph) => void
  setGapFill: (v: string | null) => void
  setGridLines: (v: boolean) => void
  /** Restore defaults (blank gaps, no fill, grid lines on). */
  reset: () => void
}

const prefs = loadPrefs()

const DEFAULTS: DisplayStyle = { gapGlyph: 'blank', gapFill: null, gridLines: true }

function persist(s: DisplayStyle) {
  savePrefs({ gapGlyph: s.gapGlyph, gapFill: s.gapFill, gridLines: s.gridLines })
}

export const useDisplayStyle = create<DisplayStyleState>((set, get) => ({
  gapGlyph: prefs.gapGlyph ?? DEFAULTS.gapGlyph,
  gapFill: prefs.gapFill ?? DEFAULTS.gapFill,
  gridLines: prefs.gridLines ?? DEFAULTS.gridLines,
  setGapGlyph: (v) => {
    set({ gapGlyph: v })
    persist(get())
  },
  setGapFill: (v) => {
    set({ gapFill: v })
    persist(get())
  },
  setGridLines: (v) => {
    set({ gridLines: v })
    persist(get())
  },
  reset: () => {
    set({ ...DEFAULTS })
    persist(get())
  },
}))

/** Snapshot of just the style fields (for seeding the renderer). */
export function displayStyleSnapshot(): DisplayStyle {
  const s = useDisplayStyle.getState()
  return { gapGlyph: s.gapGlyph, gapFill: s.gapFill, gridLines: s.gridLines }
}
