import { create } from 'zustand'
import { loadPrefs, savePrefs } from '../editor/persistence'

// Central visibility state for every floating/analytical panel plus the residue
// tooltip. Replaces the ~12 useState booleans + ~24 props that used to be drilled
// from App into the Toolbar: menus now flip panels directly via usePanels, and
// App reads the same store to decide what to render.

export type PanelKey =
  | 'legend'
  | 'minimap'
  | 'structure'
  | 'scores'
  | 'cluster'
  | 'tree'
  | 'align'
  | 'identity'
  | 'motif'
  | 'barcode'
  | 'variant'

interface PanelsState extends Record<PanelKey, boolean> {
  /** Residue tooltip on hover. */
  tooltip: boolean
  toggle: (k: PanelKey) => void
  set: (k: PanelKey, v: boolean) => void
  setTooltip: (v: boolean) => void
}

const prefs = loadPrefs()

// Only a subset of panels is remembered across reloads (the display-oriented
// ones); analytical dialogs always start closed.
function persist(s: PanelsState) {
  savePrefs({
    showLegend: s.legend,
    showMinimap: s.minimap,
    showStructure: s.structure,
    showScores: s.scores,
    showBarcode: s.barcode,
    tooltipEnabled: s.tooltip,
  })
}

export const usePanels = create<PanelsState>((set, get) => ({
  legend: prefs.showLegend ?? true,
  minimap: prefs.showMinimap ?? true,
  structure: prefs.showStructure ?? false,
  scores: prefs.showScores ?? false,
  barcode: prefs.showBarcode ?? false,
  cluster: false,
  tree: false,
  align: false,
  identity: false,
  motif: false,
  variant: false,
  tooltip: prefs.tooltipEnabled ?? true,
  toggle: (k) => {
    set((s) => ({ [k]: !s[k] }) as Pick<PanelsState, PanelKey>)
    persist(get())
  },
  set: (k, v) => {
    set(() => ({ [k]: v }) as Pick<PanelsState, PanelKey>)
    persist(get())
  },
  setTooltip: (v) => {
    set({ tooltip: v })
    persist(get())
  },
}))
