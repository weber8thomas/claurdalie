// Lightweight localStorage persistence for preferences and the last dataset.

const PREFS = 'claurdalie.prefs'
const ALN = 'claurdalie.aln'
const KIND = 'claurdalie.alnKind' // 'content' | 'demo' | 'heavy' | 'huge'

/** Persisted geometry for one floating/dockable panel window. */
export interface PanelWindowPref {
  x: number
  y: number
  w: number
  h: number
  docked?: boolean
  fullscreen?: boolean
  dockOrder?: number
  collapsed?: boolean
}

export interface Prefs {
  dark?: boolean
  schemeId?: string
  showLegend?: boolean
  showMinimap?: boolean
  tooltipEnabled?: boolean
  minimapW?: number
  minimapH?: number
  showStructure?: boolean
  structureW?: number
  structureH?: number
  showScores?: boolean
  scoresH?: number
  showBarcode?: boolean
  /** Per-panel window geometry (position/size/pin/dock/fullscreen), keyed by PanelKey. */
  panelWindows?: Record<string, PanelWindowPref>
  /** Gap / whitespace display style. */
  gapGlyph?: 'blank' | 'dash' | 'dot' | 'cross'
  gapFill?: string | null
  gridLines?: boolean
  /** Expanded width of the Panels dock rail. */
  railWidth?: number
}

export function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS) || '{}')
  } catch {
    return {}
  }
}

export function savePrefs(partial: Prefs): void {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ ...loadPrefs(), ...partial }))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

/** Persist the alignment as FASTA content (small datasets only). */
export function saveAlignmentContent(fasta: string): void {
  try {
    localStorage.setItem(ALN, fasta)
    localStorage.setItem(KIND, 'content')
  } catch {
    try {
      localStorage.removeItem(ALN)
      localStorage.setItem(KIND, 'demo')
    } catch {
      /* ignore */
    }
  }
}

/** Persist only a dataset kind to regenerate (large generated datasets). */
export function saveDatasetKind(kind: string): void {
  try {
    localStorage.setItem(KIND, kind)
    localStorage.removeItem(ALN)
  } catch {
    /* ignore */
  }
}

export function loadDataset(): { kind: string; fasta?: string } {
  try {
    const kind = localStorage.getItem(KIND) || 'demo'
    return { kind, fasta: kind === 'content' ? localStorage.getItem(ALN) || undefined : undefined }
  } catch {
    return { kind: 'demo' }
  }
}
