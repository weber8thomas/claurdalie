import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { ConservationModel } from '../analysis/conservation/ConservationModel'
import { METHODS, type ConservationMethodId } from '../analysis/conservation/types'
import {
  ScoreTrackRenderer,
  METHOD_COLORS,
  LIGHT_TRACK,
  DARK_TRACK,
  type TrackInput,
} from '../render/ScoreTrackRenderer'
import { useEditorSnapshot } from './useEditor'

const PANEL_H = 104

interface Props {
  ctrl: EditorController
  model: ConservationModel
  onClose: () => void
}

/**
 * The conservation scores panel: chrome (method chips + close) plus a canvas
 * strip drawn imperatively by ScoreTrackRenderer, kept column-aligned with the
 * alignment via the GridRenderer's view listener.
 */
export function ScoresPanel({ ctrl, model, onClose }: Props) {
  const snap = useEditorSnapshot(ctrl)
  // Re-render chrome when the model changes (computing state, shown set).
  useSyncExternalStore(
    (fn) => model.subscribe(fn),
    () => model.shownMethods().join(',') + '|' + METHODS.map((m) => model.isComputing(m.id)).join(''),
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
      r.resize(rect.width, PANEL_H)
      const shown = model.shownMethods()
      const tracks: TrackInput[] = []
      for (const m of shown) {
        const t = model.track(m)
        if (t) tracks.push({ method: m, track: t, color: METHOD_COLORS[m], emphasis: shown.length === 1 })
      }
      r.draw({
        cellW: ctrl.renderer.cellW,
        scrollX: ctrl.renderer.scrollX,
        gridWidthPx: ctrl.renderer.gridWidthPx,
        colCount: ctrl.store.width,
        theme: snap.dark ? DARK_TRACK : LIGHT_TRACK,
        tracks,
      })
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
  }, [ctrl, model, snap.dark])

  return (
    <div className="scores-panel" ref={wrapRef}>
      <div className="scores-chrome">
        <span className="scores-title">Conservation</span>
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
        <button className="scores-close" title="Hide scores" onClick={onClose}>
          ✕
        </button>
      </div>
      <canvas ref={canvasRef} className="scores-canvas" />
    </div>
  )
}
