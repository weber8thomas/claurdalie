// Thin wrapper around the molecular viewer, behind a strict interface.
//
// Two reasons for the seam: (1) the concrete library (3Dmol.js here) is heavy
// and WebGL-bound, so it is dynamically imported only when the panel first
// opens — the editor's bundle and cold-start are untouched; (2) the library is
// swappable (Mol*/NGL) without touching the panel or controller.
//
// Everything here is viewer-local and event-driven: it renders on load, on a
// residue highlight change, and on resize — never in lockstep with the
// alignment grid's render loop.

import type { Structure } from './types'

export interface StructureViewer {
  /** Replace the displayed model. */
  load(structure: Structure): void
  /** Highlight one 0-based residue (by structure order), or clear with null. */
  highlightResidue(index: number | null): void
  /** Register a click handler; fires with the 0-based residue index or null. */
  onResiduePick(cb: (index: number | null) => void): void
  /** Recompute canvas size (call on panel resize). */
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

type PickCb = (index: number | null) => void

/**
 * Create a 3Dmol-backed viewer inside `container`. Dynamically imports the
 * library so it is excluded from the main bundle.
 */
export async function createStructureViewer(
  container: HTMLElement,
  opts: { dark: boolean },
): Promise<StructureViewer> {
  const $3Dmol = await import('3dmol')
  const viewer = $3Dmol.createViewer(container, {
    backgroundColor: opts.dark ? '#12141c' : '#ffffff',
  })

  // Ordinal (0-based structure order) -> PDB resi number, so highlight/pick work
  // regardless of how the source numbers residues (ESMFold is 1..N; files vary).
  let ordinalToResi: number[] = []
  let resiToOrdinal = new Map<number, number>()
  let highlighted: number | null = null
  let pickCb: PickCb | null = null

  const byPlddt = (atom: { b?: number }) => plddtColor(typeof atom.b === 'number' ? atom.b : 0)

  // Cartoon (ribbons with secondary structure) is the primary representation,
  // colored by pLDDT — the standard look for AlphaFold/ESMFold models. A thin
  // line backbone is layered in so *something* always renders even when no
  // cartoon geometry is produced (very short peptides / coordinate-only models).
  const applyBase = () => {
    viewer.setStyle(
      {},
      {
        cartoon: { colorfunc: byPlddt, arrows: true },
        line: { colorfunc: byPlddt },
      },
    )
  }

  const HIGHLIGHT = '#ff2e88'
  const applyHighlight = () => {
    if (highlighted == null) return
    const resi = ordinalToResi[highlighted]
    if (resi == null) return
    viewer.addStyle({ resi }, { cartoon: { color: HIGHLIGHT }, stick: { radius: 0.35, color: HIGHLIGHT } })
  }

  return {
    load(structure: Structure) {
      viewer.removeAllModels()
      viewer.addModel(structure.pdb, 'pdb')

      // Capture residue order from Cα atoms.
      const cas = viewer.selectedAtoms({ atom: 'CA' }) as Array<{ resi: number }>
      ordinalToResi = cas.map((a) => a.resi)
      resiToOrdinal = new Map(ordinalToResi.map((resi, i) => [resi, i]))
      highlighted = null

      applyBase()
      viewer.setClickable({}, true, (atom: { resi?: number }) => {
        if (!pickCb) return
        const ord = atom.resi != null ? resiToOrdinal.get(atom.resi) : undefined
        pickCb(ord ?? null)
      })
      viewer.zoomTo()
      viewer.render()
    },

    highlightResidue(index: number | null) {
      if (index === highlighted) return
      highlighted = index
      applyBase() // clear any previous highlight
      applyHighlight()
      viewer.render()
    },

    onResiduePick(cb: PickCb) {
      pickCb = cb
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
        /* viewer may already be torn down */
      }
    },
  }
}
