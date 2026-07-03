import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { GroupModel } from '../analysis/cluster/GroupModel'
import type { MotifModel } from '../analysis/motif/MotifModel'
import { BarcodeRenderer, LIGHT_BARCODE, DARK_BARCODE, type BarcodeLane } from '../render/BarcodeRenderer'
import { countColumn, newCounts } from '../analysis/conservation/columnCounts'
import { useEditorSnapshot } from './useEditor'

const PANEL_H = 132

interface Props {
  ctrl: EditorController
  group: GroupModel
  motif?: MotifModel | null
  onClose: () => void
}

interface LaneSpec {
  name: string
  color: string
  rows: number[] // visual rows
}

/** Per-lane conservation (threshold) + gap density computed straight from the store. */
function computeLanes(ctrl: EditorController, specs: LaneSpec[], motif: MotifModel | null | undefined): BarcodeLane[] {
  const store = ctrl.store
  const cols = store.width
  const counts = newCounts()
  return specs.map((spec) => {
    const conservation = new Float32Array(cols)
    const gap = new Float32Array(cols)
    const feature = motif ? new Uint8Array(cols) : undefined
    const nRows = spec.rows.length
    for (let c = 0; c < cols; c++) {
      counts.fill(0)
      const total = countColumn((r) => store.residueAt(spec.rows[r], c), nRows, counts)
      let max = 0
      for (let code = 1; code < counts.length; code++) if (counts[code] > max) max = counts[code]
      conservation[c] = total > 0 ? (max / total) * 100 : NaN
      gap[c] = nRows > 0 ? (nRows - total) / nRows : 0
    }
    if (feature) {
      for (const v of spec.rows) for (const [c0, c1] of motif!.rangesOf(v)) for (let c = c0; c < c1; c++) feature[c] = 1
    }
    return { name: spec.name, color: spec.color, conservation, gap, feature }
  })
}

export function BarcodePanel({ ctrl, group, motif, onClose }: Props) {
  const snap = useEditorSnapshot(ctrl)
  const contentVersion = ctrl.getContentVersion()
  // Re-derive lanes when the grouping changes.
  const groupsSig = useSyncExternalStore(
    (fn) => group.subscribe(fn),
    () => group.clusterInfos().map((c) => `${c.id}:${c.size}`).join(','),
  )
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<BarcodeRenderer | null>(null)
  const lanesRef = useRef<BarcodeLane[]>([])

  useEffect(() => {
    if (!canvasRef.current) return
    rendererRef.current = new BarcodeRenderer(canvasRef.current)
  }, [])

  // Recompute lane data only on data / grouping changes (not on scroll).
  useEffect(() => {
    const specs: LaneSpec[] = group.hasGroups()
      ? group.groups().map((g) => ({ name: g.name, color: g.color, rows: g.rows }))
      : [{ name: 'All sequences', color: '#5b7cf0', rows: Array.from({ length: ctrl.store.height }, (_, v) => v) }]
    lanesRef.current = ctrl.store.height > 0 ? computeLanes(ctrl, specs, motif) : []
    repaint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl, group, motif, groupsSig, contentVersion, snap.rows, snap.cols])

  const repaint = () => {
    const r = rendererRef.current
    const wrap = wrapRef.current
    if (!r || !wrap) return
    const rect = wrap.getBoundingClientRect()
    r.resize(rect.width, PANEL_H)
    r.draw({
      cellW: ctrl.renderer.cellW,
      scrollX: ctrl.renderer.scrollX,
      gridWidthPx: ctrl.renderer.gridWidthPx,
      colCount: ctrl.store.width,
      theme: snap.dark ? DARK_BARCODE : LIGHT_BARCODE,
      lanes: lanesRef.current,
    })
  }

  // Repaint on view changes (scroll/zoom), theme, and size — cheap (no recompute).
  useEffect(() => {
    repaint()
    const offView = ctrl.renderer.addViewListener(repaint)
    const offMotif = motif?.subscribe(repaint)
    const ro = new ResizeObserver(repaint)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => {
      offView()
      offMotif?.()
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl, motif, snap.dark])

  return (
    <div className="scores-panel barcode-panel" ref={wrapRef}>
      <div className="scores-chrome">
        <span className="scores-title">Barcode</span>
        <span className="barcode-sub">{group.hasGroups() ? `${group.clusterInfos().length} groups` : 'no clusters'}</span>
        <button className="scores-close" title="Hide barcode" onClick={onClose}>
          ✕
        </button>
      </div>
      <canvas ref={canvasRef} className="scores-canvas" />
    </div>
  )
}
