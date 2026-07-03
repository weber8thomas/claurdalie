import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { ConservationModel } from '../analysis/conservation/ConservationModel'
import { METHODS, type ConservationMethodId } from '../analysis/conservation/types'
import {
  ScoreTrackRenderer,
  METHOD_COLORS,
  LIGHT_TRACK,
  DARK_TRACK,
  TRACK_ROW_H,
  type TrackRow,
} from '../render/ScoreTrackRenderer'
import type { GroupModel } from '../analysis/cluster/GroupModel'
import { useEditorSnapshot } from './useEditor'

/** Draggable panel height bounds. */
const MIN_H = 72
const MAX_H = 360

interface Props {
  ctrl: EditorController
  model: ConservationModel
  group?: GroupModel | null
  height: number
  onResize: (h: number) => void
  onClose: () => void
}

/**
 * The conservation scores panel: chrome (method chips + close) plus a canvas
 * strip drawn imperatively by ScoreTrackRenderer, kept column-aligned with the
 * alignment via the GridRenderer's view listener.
 */
export function ScoresPanel({ ctrl, model, group, height, onResize, onClose }: Props) {
  const snap = useEditorSnapshot(ctrl)
  // Re-render chrome when the model changes (mode, shown set, computing state).
  useSyncExternalStore(
    (fn) => model.subscribe(fn),
    () =>
      model.mode_() +
      '|' +
      model.clusterMethod_() +
      '|' +
      model.shownMethods().join(',') +
      '|' +
      METHODS.map((m) => model.isComputing(m.id)).join(''),
  )
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<ScoreTrackRenderer | null>(null)
  const [, force] = useState(0)

  // Mount the canvas renderer once.
  useEffect(() => {
    if (!canvasRef.current) return
    rendererRef.current = new ScoreTrackRenderer(canvasRef.current)
    force((n) => n + 1)
  }, [])

  // Repaint on: view changes (scroll/zoom), model changes, content, theme, size.
  useEffect(() => {
    const r = rendererRef.current
    const wrap = wrapRef.current
    if (!r || !wrap) return

    const paint = () => {
      const rect = wrap.getBoundingClientRect()
      const theme = snap.dark ? DARK_TRACK : LIGHT_TRACK
      const geom = {
        cellW: ctrl.renderer.cellW,
        scrollX: ctrl.renderer.scrollX,
        gridWidthPx: ctrl.renderer.gridWidthPx,
        colCount: ctrl.store.width,
        theme,
      }

      // Cluster view: a single method, columns painted by conservation class.
      if (model.mode_() === 'cluster') {
        r.resize(rect.width, height)
        const method = model.clusterMethod_()
        r.drawClusters({ ...geom, dark: snap.dark, method, track: model.track(method) })
        return
      }

      // Tracks view: one stacked row per shown method (Jalview annotation stack).
      const groupColor = (id: number) => group?.clusterInfos().find((c) => c.id === id)?.color ?? METHOD_COLORS.multi
      const shown = model.shownMethods()
      const rows: TrackRow[] = []
      for (const m of shown) {
        const t = model.track(m)
        if (!t) continue
        const groups = t.groupScores?.map((gs) => ({ color: groupColor(gs.id), scores: gs.scores }))
        rows.push({ method: m, scores: t.scores, color: METHOD_COLORS[m], groups })
      }
      // User-set panel height; rows scale to fill it (min one row's worth).
      r.resize(rect.width, Math.max(TRACK_ROW_H, height))
      r.draw({ ...geom, rows })
    }

    paint()
    const offView = ctrl.renderer.addViewListener(paint)
    const offModel = model.subscribe(paint)
    const ro = new ResizeObserver(paint)
    ro.observe(wrap)
    return () => {
      offView()
      offModel()
      ro.disconnect()
    }
  }, [ctrl, model, group, snap.dark, height])

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const sy = e.clientY
    const sh = height
    const move = (ev: PointerEvent) => {
      // Panel sits at the bottom, so dragging the top edge UP makes it taller.
      onResize(Math.round(Math.max(MIN_H, Math.min(MAX_H, sh - (ev.clientY - sy)))))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const mode = model.mode_()
  const clusterMethod = model.clusterMethod_()

  return (
    <div className="scores-panel" ref={wrapRef}>
      <div className="scores-resize" title="Resize" onPointerDown={startResize} />
      <div className="scores-chrome">
        <span className="scores-title">Conservation</span>
        <div className="scores-mode" role="tablist" aria-label="Conservation view">
          <button
            role="tab"
            aria-selected={mode === 'tracks'}
            className={'seg' + (mode === 'tracks' ? ' on' : '')}
            title="Overlay one or more conservation scores as tracks (Jalview-style)"
            onClick={() => void model.setMode('tracks')}
          >
            Tracks
          </button>
          <button
            role="tab"
            aria-selected={mode === 'cluster'}
            className={'seg' + (mode === 'cluster' ? ' on' : '')}
            title="Cluster columns into well- vs. poorly-conserved residues (Cluspack-style)"
            onClick={() => void model.setMode('cluster')}
          >
            Clusters
          </button>
        </div>
        {mode === 'tracks' ? (
          <div className="scores-methods">
            {METHODS.map((m) => (
              <button
                key={m.id}
                className={'chip' + (model.isShown(m.id) ? ' on' : '')}
                title={m.blurb}
                onClick={() => void model.toggle(m.id as ConservationMethodId)}
              >
                {model.isComputing(m.id) ? '…' : ''}
                {m.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="scores-methods">
            <span className="scores-sublabel">cluster on</span>
            {METHODS.map((m) => (
              <button
                key={m.id}
                className={'chip' + (clusterMethod === m.id ? ' on' : '')}
                title={`Group columns by ${m.label}: ${m.blurb}`}
                onClick={() => void model.setClusterMethod(m.id as ConservationMethodId)}
              >
                {model.isComputing(m.id) && clusterMethod === m.id ? '…' : ''}
                {m.label}
              </button>
            ))}
          </div>
        )}
        <button className="scores-close" title="Hide scores" onClick={onClose}>
          ✕
        </button>
      </div>
      <canvas ref={canvasRef} className="scores-canvas" />
    </div>
  )
}
