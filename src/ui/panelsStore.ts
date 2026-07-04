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
  | 'display'

/** Live geometry + window flags for one panel. */
export interface PanelWindow {
  x: number
  y: number
  w: number
  h: number
  z: number
  docked: boolean
  fullscreen: boolean
  /** Order within the dock rail (lower = higher up); only meaningful when docked. */
  dockOrder: number
  /** Collapsed to just its header inside the dock rail. */
  collapsed: boolean
}

/** Seed passed by a FloatingPanel on first mount (geometry only). */
export interface WindowSeed {
  x: number
  y: number
  w: number
  h: number
}

/** Transient state while a docked panel is being dragged to reorder. */
export interface DockDrag {
  key: PanelKey
  dropIndex: number
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
  /** Live reorder state (the dragged docked panel + its would-be drop index). */
  dockDrag: DockDrag | null
  toggle: (k: PanelKey) => void
  set: (k: PanelKey, v: boolean) => void
  setTooltip: (v: boolean) => void
  /** Seed a window's geometry once (idempotent — never clobbers an existing one). */
  ensureWindow: (k: PanelKey, seed: WindowSeed) => void
  moveWindow: (k: PanelKey, x: number, y: number) => void
  resizeWindow: (k: PanelKey, w: number, h: number, x?: number, y?: number) => void
  bringToFront: (k: PanelKey) => void
  toggleDocked: (k: PanelKey) => void
  toggleFullscreen: (k: PanelKey) => void
  toggleCollapsed: (k: PanelKey) => void
  /** Move a docked panel to a new position in the rail (reorder by drag). */
  moveDock: (k: PanelKey, toIndex: number) => void
  setDockDrag: (d: DockDrag | null) => void
  setRailCollapsed: (v: boolean) => void
}

const prefs = loadPrefs()

// Floating panels occupy a compact z band starting at Z_BASE. bringToFront
// re-packs z so it never grows unbounded and always stays well below Mantine's
// pop-up z-index (300) — so menus/selects/tooltips always render above panels.
const Z_BASE = 20

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

/** Persist just the window-geometry map (position/size/dock/fullscreen/order). */
function persistWindows(s: PanelsState) {
  const out: Record<string, PanelWindowPref> = {}
  for (const [k, w] of Object.entries(s.windows)) {
    if (!w) continue
    out[k] = {
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
      docked: w.docked,
      fullscreen: w.fullscreen,
      dockOrder: w.dockOrder,
      collapsed: w.collapsed,
    }
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
    z: ++seedZ,
    docked: !!p.docked,
    fullscreen: !!p.fullscreen,
    dockOrder: p.dockOrder ?? seedZ,
    collapsed: !!p.collapsed,
  }
}

// Dock-rail widths (kept in step with .dock-rail / .dock-rail.collapsed in CSS).
const RAIL_W = 360
const RAIL_COLLAPSED_W = 34

/** Width reserved on the right by the Panels rail (0 when nothing is docked). */
export function railInset(s: Pick<PanelsState, 'windows' | 'railCollapsed'>): number {
  const anyDocked = Object.values(s.windows).some((w) => w?.docked)
  if (!anyDocked) return 0
  return s.railCollapsed ? RAIL_COLLAPSED_W : RAIL_W
}

/** Re-clamp every FLOATING window's x against a right inset (rail width). */
function reclampFloating(
  windows: Partial<Record<PanelKey, PanelWindow>>,
  inset: number,
): Partial<Record<PanelKey, PanelWindow>> {
  const out = { ...windows }
  for (const [k, w] of Object.entries(out) as [PanelKey, PanelWindow][]) {
    if (!w || w.docked) continue
    const p = clampPos(w.x, w.y, w.w, inset)
    if (p.x !== w.x) out[k] = { ...w, x: p.x }
  }
  return out
}

/** Clamp a top-left position so the title bar stays on-screen and left of the rail. */
function clampPos(x: number, y: number, w: number, rightInset = 0): { x: number; y: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  const margin = 24
  const TOOLBAR_H = 44 // keep the title bar clear of the top menu bar
  return {
    x: Math.max(margin - w, Math.min(x, vw - rightInset - margin)),
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
  display: false,
  tooltip: prefs.tooltipEnabled ?? true,
  windows: savedWindows,
  zTop: seedZ,
  railCollapsed: false,
  dockDrag: null,
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
    const { x, y } = clampPos(seed.x, seed.y, seed.w, railInset(get()))
    const z = get().zTop + 1
    set((s) => ({
      zTop: z,
      windows: {
        ...s.windows,
        [k]: { x, y, w: seed.w, h: seed.h, z, docked: false, fullscreen: false, dockOrder: z, collapsed: false },
      },
    }))
    persistWindows(get())
  },
  moveWindow: (k, x, y) => {
    const cur = get().windows[k]
    if (!cur) return
    const p = clampPos(x, y, cur.w, railInset(get()))
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
    // Re-pack floating z into a compact, bounded band so it never approaches the
    // Mantine pop-up z-index (300) — the focused panel goes on top.
    const floating = Object.entries(get().windows).filter(([key, w]) => w && !w.docked && key !== k) as [
      PanelKey,
      PanelWindow,
    ][]
    floating.sort((a, b) => a[1].z - b[1].z)
    const order = [...floating.map(([key]) => key), k]
    const windows = { ...get().windows }
    order.forEach((key, i) => {
      const w = windows[key]
      if (w) windows[key] = { ...w, z: Z_BASE + i }
    })
    set({ windows, zTop: Z_BASE + order.length })
  },
  toggleDocked: (k) => {
    const cur = get().windows[k]
    if (!cur) return
    const docked = !cur.docked
    // Docking appends to the end of the rail; leaving it drops fullscreen.
    const maxOrder = Math.max(0, ...Object.values(get().windows).map((w) => (w?.docked ? w.dockOrder : 0)))
    const next = {
      ...get().windows,
      [k]: { ...cur, docked, fullscreen: false, collapsed: false, dockOrder: docked ? maxOrder + 1 : cur.dockOrder },
    }
    // The rail may have just appeared/disappeared — slide floating panels out from
    // behind it (or let them reclaim the space when the last panel undocks).
    const inset = railInset({ windows: next, railCollapsed: get().railCollapsed })
    set({ windows: reclampFloating(next, inset) })
    persistWindows(get())
  },
  toggleFullscreen: (k) => {
    const cur = get().windows[k]
    if (!cur) return
    set((s) => ({ windows: { ...s.windows, [k]: { ...cur, fullscreen: !cur.fullscreen } } }))
    persistWindows(get())
  },
  toggleCollapsed: (k) => {
    const cur = get().windows[k]
    if (!cur) return
    set((s) => ({ windows: { ...s.windows, [k]: { ...cur, collapsed: !cur.collapsed } } }))
    persistWindows(get())
  },
  moveDock: (k, toIndex) => {
    const cur = get().windows[k]
    if (!cur || !cur.docked) return
    const docked = (Object.entries(get().windows).filter(([, w]) => w?.docked) as [PanelKey, PanelWindow][]).sort(
      (a, b) => a[1].dockOrder - b[1].dockOrder,
    )
    const keys = docked.map(([key]) => key).filter((key) => key !== k)
    const idx = Math.max(0, Math.min(toIndex, keys.length))
    keys.splice(idx, 0, k)
    const windows = { ...get().windows }
    keys.forEach((key, i) => {
      const w = windows[key]
      if (w) windows[key] = { ...w, dockOrder: i }
    })
    set({ windows })
    persistWindows(get())
  },
  setDockDrag: (d) => set({ dockDrag: d }),
  setRailCollapsed: (v) => {
    // Expanding the rail widens the reserved area — push floating panels left so
    // none end up hidden behind it.
    const inset = railInset({ windows: get().windows, railCollapsed: v })
    set({ railCollapsed: v, windows: reclampFloating(get().windows, inset) })
    persistWindows(get())
  },
}))
