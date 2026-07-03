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
import type { GroupModel } from '../analysis/cluster/GroupModel'
import { useEditorSnapshot } from './useEditor'

const PANEL_H = 104

interface Props {
  ctrl: EditorController
  model: ConservationModel
  group?: GroupModel | null
  onClose: () => void
}

/**
 * The conservation scores panel: chrome (method chips + close) plus a canvas
 * strip drawn imperatively by ScoreTrackRenderer, kept column-aligned with the
 * alignment via the GridRenderer's view listener.
 */
export function ScoresPanel({ ctrl, model, group, onClose }: Props) {
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
      const axis = snap.dark ? '#e8e8ea' : '#1a1a1e'
      const groupColor = (id: number) => group?.clusterInfos().find((c) => c.id === id)?.color ?? METHOD_COLORS.multi
      const tracks: TrackInput[] = []
      for (const m of shown) {
        const t = model.track(m)
        if (!t) continue
        const hasGroups = (t.groupScores?.length ?? 0) > 0
        // With groups, the global line is the neutral axis color and each group
        // gets its cluster color; without groups, the method's own color.
        tracks.push({ method: m, track: t, color: hasGroups ? axis : METHOD_COLORS[m], emphasis: true })
        if (t.groupScores) {
          for (const gs of t.groupScores) {
            tracks.push({ method: m, track: { method: m, scores: gs.scores }, color: groupColor(gs.id), emphasis: false })
          }
        }
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
