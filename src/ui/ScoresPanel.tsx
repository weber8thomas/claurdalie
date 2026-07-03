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
      r.resize(rect.width, PANEL_H)
      const theme = snap.dark ? DARK_TRACK : LIGHT_TRACK

      // Cluster view: a single method, columns painted by conservation class.
      if (model.mode_() === 'cluster') {
        const method = model.clusterMethod_()
        r.drawClusters({
          cellW: ctrl.renderer.cellW,
          scrollX: ctrl.renderer.scrollX,
          gridWidthPx: ctrl.renderer.gridWidthPx,
          colCount: ctrl.store.width,
          theme,
          dark: snap.dark,
          method,
          track: model.track(method),
        })
        return
      }

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
        theme,
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

  const mode = model.mode_()
  const clusterMethod = model.clusterMethod_()

  return (
    <div className="scores-panel" ref={wrapRef}>
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
