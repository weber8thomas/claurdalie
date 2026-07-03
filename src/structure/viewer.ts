// Multi-model molecular viewer behind a strict interface.
//
// Dynamically imported (heavy, WebGL) so the editor bundle/cold-start are
// untouched, and swappable (Mol*/NGL) without touching the panel/controller.
// Supports several structures at once — each with its own solid color for
// side-by-side comparison — plus color modes, representations, a reset view,
// and a PNG snapshot. All updates are event-driven (load / restyle / highlight
// / resize), never in lockstep with the alignment grid's render loop.

export interface ViewerModel {
  id: string
  pdb: string
  /** Per-residue pLDDT (0..100); empty if unknown. */
  plddt: (number | null)[]
  /** Solid color used in the per-model color mode. */
  color: string
}

export type ColorMode = 'plddt' | 'model' | 'spectrum' | 'chain'
export type Representation = 'cartoon' | 'trace' | 'stick' | 'sphere'

export interface StructureViewer {
  /** Reconcile the displayed set of models. `fit` re-centers the camera. */
  setModels(models: ViewerModel[], fit?: boolean): void
  setColorMode(mode: ColorMode): void
  setRepresentation(rep: Representation): void
  /** Highlight residue `index` (0-based) of model `modelId`; null clears. */
  highlightResidue(modelId: string | null, index: number | null): void
  onResiduePick(cb: (modelId: string, index: number | null) => void): void
  resetView(): void
  /** PNG data URL of the current view, or null if unavailable. */
  snapshot(): string | null
  resize(): void
  dispose(): void
}

/** AlphaFold-style pLDDT confidence bands (blue = high, orange = very low). */
function plddtColor(b: number): string {
  if (b >= 90) return '#0053d6'
  if (b >= 70) return '#65cbf3'
  if (b >= 50) return '#ffdb13'
  return '#ff7d45'
}

function hslHex(h: number, s = 0.7, l = 0.5): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

const CHAIN_COLORS = ['#2bb3a3', '#f3a83c', '#5b7cf0', '#ef5d6c', '#8b5cf6', '#22c55e']

const HIGHLIGHT = '#ff2e88'

interface Entry {
  glModel: { setStyle: (sel: unknown, style: unknown, add?: boolean) => void }
  color: string
  resiMin: number
  resiMax: number
  ordinalToResi: number[]
  resiToOrdinal: Map<number, number>
}

export async function createStructureViewer(
  container: HTMLElement,
  opts: { dark: boolean },
): Promise<StructureViewer> {
  const $3Dmol = await import('3dmol')
  const viewer = $3Dmol.createViewer(container, {
    backgroundColor: opts.dark ? '#12141c' : '#ffffff',
  })

  const entries = new Map<string, Entry>()
  let order: string[] = []
  let colorMode: ColorMode = 'plddt'
  let representation: Representation = 'cartoon'
  let highlighted: { id: string; index: number } | null = null
  let pickCb: ((id: string, index: number | null) => void) | null = null

  const colorProps = (e: Entry) => {
    switch (colorMode) {
      case 'model':
        return { color: e.color }
      case 'spectrum':
        return {
          colorfunc: (a: { resi?: number }) => {
            const span = e.resiMax - e.resiMin || 1
            const t = ((a.resi ?? e.resiMin) - e.resiMin) / span
            return hslHex(0.66 * (1 - t)) // blue(N) -> red(C)
          },
        }
      case 'chain':
        return {
          colorfunc: (a: { chain?: string }) => {
            const c = (a.chain ?? 'A').charCodeAt(0)
            return CHAIN_COLORS[c % CHAIN_COLORS.length]
          },
        }
      case 'plddt':
      default:
        return { colorfunc: (a: { b?: number }) => plddtColor(typeof a.b === 'number' ? a.b : 0) }
    }
  }

  const repStyle = (e: Entry) => {
    const c = colorProps(e)
    // A thin backbone line underlays the ribbon representations so a structure
    // is always visible even when triangulated cartoon geometry isn't produced
    // (very short peptides, coordinate-only models, software WebGL).
    switch (representation) {
      case 'trace':
        return { cartoon: { style: 'trace', thickness: 0.5, ...c }, line: { ...c } }
      case 'stick':
        return { stick: { radius: 0.15, ...c } }
      case 'sphere':
        return { sphere: { scale: 0.28, ...c } }
      case 'cartoon':
      default:
        return { cartoon: { arrows: true, ...c }, line: { ...c } }
    }
  }

  const restyle = () => {
    for (const id of order) {
      const e = entries.get(id)
      if (e) e.glModel.setStyle({}, repStyle(e))
    }
    if (highlighted) applyHighlight()
    viewer.render()
  }

  const applyHighlight = () => {
    if (!highlighted) return
    const e = entries.get(highlighted.id)
    if (!e) return
    const resi = e.ordinalToResi[highlighted.index]
    if (resi == null) return
    e.glModel.setStyle({ resi }, { cartoon: { color: HIGHLIGHT }, stick: { radius: 0.35, color: HIGHLIGHT } }, true)
  }

  return {
    setModels(models: ViewerModel[], fit = false) {
      const had = entries.size
      viewer.removeAllModels()
      entries.clear()
      order = []
      for (const m of models) {
        const glModel = viewer.addModel(m.pdb, 'pdb')
        const cas = (glModel as unknown as { selectedAtoms: (s: unknown) => Array<{ resi: number }> }).selectedAtoms({
          atom: 'CA',
        })
        const ordinalToResi = cas.map((a) => a.resi)
        const resiToOrdinal = new Map(ordinalToResi.map((resi, i) => [resi, i]))
        entries.set(m.id, {
          glModel: glModel as Entry['glModel'],
          color: m.color,
          resiMin: ordinalToResi.length ? Math.min(...ordinalToResi) : 0,
          resiMax: ordinalToResi.length ? Math.max(...ordinalToResi) : 0,
          ordinalToResi,
          resiToOrdinal,
        })
        order.push(m.id)
      }
      if (highlighted && !entries.has(highlighted.id)) highlighted = null
      restyle()
      viewer.setClickable({}, true, (atom: { resi?: number; model?: number }) => {
        if (!pickCb) return
        const id = atom.model != null ? order[atom.model] : order[0]
        const e = id ? entries.get(id) : undefined
        const ord = e && atom.resi != null ? e.resiToOrdinal.get(atom.resi) : undefined
        if (id) pickCb(id, ord ?? null)
      })
      if (fit || had === 0) viewer.zoomTo()
      viewer.render()
    },

    setColorMode(mode: ColorMode) {
      if (mode === colorMode) return
      colorMode = mode
      restyle()
    },
    setRepresentation(rep: Representation) {
      if (rep === representation) return
      representation = rep
      restyle()
    },

    highlightResidue(modelId: string | null, index: number | null) {
      const next = modelId != null && index != null ? { id: modelId, index } : null
      if (next?.id === highlighted?.id && next?.index === highlighted?.index) return
      highlighted = next
      restyle() // clears prior highlight and applies the new one
    },

    onResiduePick(cb) {
      pickCb = cb
    },

    resetView() {
      viewer.zoomTo()
      viewer.render()
    },

    snapshot() {
      try {
        return (viewer as unknown as { pngURI: () => string }).pngURI()
      } catch {
        return null
      }
    },

    resize() {
      viewer.resize()
      viewer.render()
    },

    dispose() {
      pickCb = null
      try {
        viewer.clear()
      } catch {
        /* already torn down */
      }
    },
  }
}
