import { create } from 'zustand'
import { loadPrefs, savePrefs, type PanelWindowPref } from '../editor/persistence'

// Central visibility state for every floating/analytical panel plus the residue
// tooltip. Replaces the ~12 useState booleans + ~24 props that used to be drilled
// from App into the Toolbar: menus now flip panels directly via usePanels, and
// App reads the same store to decide what to render.
//
// v0.10 adds a per-panel WINDOW state map: position, size, z-order, and the
// pin / dock / fullscreen flags that back the unified FloatingPanel. The open/close
// booleans (menu toggles) are unchanged; window geometry is a separate concern so
// closing a panel never loses where it was.

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

/** Live geometry + window flags for one panel. */
export interface PanelWindow {
  x: number
  y: number
  w: number
  h: number
  z: number
  pinned: boolean
  docked: boolean
  fullscreen: boolean
}

/** Seed passed by a FloatingPanel on first mount (geometry only). */
export interface WindowSeed {
  x: number
  y: number
  w: number
  h: number
}

interface PanelsState extends Record<PanelKey, boolean> {
  /** Residue tooltip on hover. */
  tooltip: boolean
  /** Per-panel window geometry/flags; absent until a panel first mounts. */
  windows: Partial<Record<PanelKey, PanelWindow>>
  /** Highest z assigned so far (monotonic; bringToFront bumps it). */
  zTop: number
  /** Whether the dock rail is collapsed to a thin tab. */
  railCollapsed: boolean
  toggle: (k: PanelKey) => void
  set: (k: PanelKey, v: boolean) => void
  setTooltip: (v: boolean) => void
  /** Seed a window's geometry once (idempotent — never clobbers an existing one). */
  ensureWindow: (k: PanelKey, seed: WindowSeed) => void
  moveWindow: (k: PanelKey, x: number, y: number) => void
  resizeWindow: (k: PanelKey, w: number, h: number, x?: number, y?: number) => void
  bringToFront: (k: PanelKey) => void
  togglePinned: (k: PanelKey) => void
  toggleDocked: (k: PanelKey) => void
  toggleFullscreen: (k: PanelKey) => void
  setRailCollapsed: (v: boolean) => void
}

const prefs = loadPrefs()

// z bands (kept in step with the --z-panel-* CSS vars). Unpinned floating panels
// start at BASE and climb via bringToFront; pinned panels jump to the PINNED band
// so they always sit above unpinned ones.
const Z_BASE = 20
const Z_PINNED = 120

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

/** Persist just the window-geometry map (position/size/pin/dock/fullscreen). */
function persistWindows(s: PanelsState) {
  const out: Record<string, PanelWindowPref> = {}
  for (const [k, w] of Object.entries(s.windows)) {
    if (!w) continue
    out[k] = { x: w.x, y: w.y, w: w.w, h: w.h, pinned: w.pinned, docked: w.docked, fullscreen: w.fullscreen }
  }
  savePrefs({ panelWindows: out })
}

// Rehydrate saved window geometry so panels reopen where they were left.
const savedWindows: Partial<Record<PanelKey, PanelWindow>> = {}
let seedZ = Z_BASE
for (const [k, p] of Object.entries(prefs.panelWindows ?? {})) {
  savedWindows[k as PanelKey] = {
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
    z: p.pinned ? Z_PINNED + seedZ : ++seedZ,
    pinned: !!p.pinned,
    docked: !!p.docked,
    fullscreen: !!p.fullscreen,
  }
}

/** Clamp a top-left position so at least a slice of the title bar stays on-screen. */
function clampPos(x: number, y: number, w: number): { x: number; y: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  const margin = 24
  const TOOLBAR_H = 44 // keep the title bar clear of the top menu bar
  return {
    x: Math.max(margin - w, Math.min(x, vw - margin)),
    y: Math.max(TOOLBAR_H, Math.min(y, vh - margin)),
  }
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
  windows: savedWindows,
  zTop: seedZ,
  railCollapsed: false,
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
  ensureWindow: (k, seed) => {
    if (get().windows[k]) return
    const { x, y } = clampPos(seed.x, seed.y, seed.w)
    const z = get().zTop + 1
    set((s) => ({
      zTop: z,
      windows: { ...s.windows, [k]: { x, y, w: seed.w, h: seed.h, z, pinned: false, docked: false, fullscreen: false } },
    }))
    persistWindows(get())
  },
  moveWindow: (k, x, y) => {
    const cur = get().windows[k]
    if (!cur) return
    const p = clampPos(x, y, cur.w)
    set((s) => ({ windows: { ...s.windows, [k]: { ...cur, x: p.x, y: p.y } } }))
    persistWindows(get())
  },
  resizeWindow: (k, w, h, x, y) => {
    const cur = get().windows[k]
    if (!cur) return
    set((s) => ({ windows: { ...s.windows, [k]: { ...cur, w, h, x: x ?? cur.x, y: y ?? cur.y } } }))
    persistWindows(get())
  },
  bringToFront: (k) => {
    const cur = get().windows[k]
    if (!cur || cur.docked) return
    const z = get().zTop + 1
    const band = cur.pinned ? Z_PINNED : 0
    set((s) => ({ zTop: z, windows: { ...s.windows, [k]: { ...cur, z: band + z } } }))
  },
  togglePinned: (k) => {
    const cur = get().windows[k]
    if (!cur) return
    const pinned = !cur.pinned
    const z = get().zTop + 1
    set((s) => ({ zTop: z, windows: { ...s.windows, [k]: { ...cur, pinned, z: (pinned ? Z_PINNED : 0) + z } } }))
    persistWindows(get())
  },
  toggleDocked: (k) => {
    const cur = get().windows[k]
    if (!cur) return
    const docked = !cur.docked
    // Leaving the dock drops fullscreen; entering it forces out of fullscreen too.
    set((s) => ({ windows: { ...s.windows, [k]: { ...cur, docked, fullscreen: false } } }))
    persistWindows(get())
  },
  toggleFullscreen: (k) => {
    const cur = get().windows[k]
    if (!cur) return
    set((s) => ({ windows: { ...s.windows, [k]: { ...cur, fullscreen: !cur.fullscreen } } }))
    persistWindows(get())
  },
  setRailCollapsed: (v) => set({ railCollapsed: v }),
}))
