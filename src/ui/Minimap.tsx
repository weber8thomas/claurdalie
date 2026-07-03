import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { ConservationModel } from '../analysis/conservation/ConservationModel'
import type { GroupModel } from '../analysis/cluster/GroupModel'
import { useEditorSnapshot } from './useEditor'
import { GAP_CODE } from '../core/alphabet'
import { countColumn, newCounts } from '../analysis/conservation/columnCounts'

const MIN_W = 120
const MIN_H = 80
const MAX_W = 460
const MAX_H = 340

type Overlay = 'residues' | 'conservation' | 'clusters'

interface Props {
  ctrl: EditorController
  width: number
  height: number
  conservation?: ConservationModel | null
  group?: GroupModel | null
  onResize: (w: number, h: number) => void
  onClose: () => void
}

/** #rrggbb → [r,g,b]. */
function hexRGB(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/**
 * Snapshot Overview (Ordalie §4.1): a downsampled schematic of the whole
 * alignment with a selectable overlay (residues / conservation / clusters), a
 * +/- zoom of the main grid scale, and a draggable viewport box that both shows
 * and drives the main window position.
 */
export function Minimap({ ctrl, width, height, conservation, group, onResize, onClose }: Props) {
  const snap = useEditorSnapshot(ctrl)
  const contentVersion = ctrl.getContentVersion()
  const [overlay, setOverlay] = useState<Overlay>('residues')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const offRef = useRef<HTMLCanvasElement | null>(null)
  const W = width
  const H = height

  // Rebuild offscreen when grouping/conservation change too (for those overlays).
  const groupsSig = useSyncExternalStore(
    (fn) => group?.subscribe(fn) ?? (() => {}),
    () => group?.clusterInfos().map((c) => `${c.id}:${c.size}`).join(',') ?? '',
  )
  const consSig = useSyncExternalStore(
    (fn) => conservation?.subscribe(fn) ?? (() => {}),
    () => conservation?.shownMethods().join(',') ?? '',
  )

  // Rebuild the downsampled heatmap when data / scheme / theme / size / overlay change.
  useEffect(() => {
    const off = document.createElement('canvas')
    off.width = W
    off.height = H
    const octx = off.getContext('2d')!
    const img = octx.createImageData(W, H)
    const data = img.data
    const { store } = ctrl
    const rows = store.height
    const cols = store.width
    const scheme = ctrl.scheme()
    const dynamic = scheme.dynamic
    const bg = snap.dark ? [26, 27, 32] : [255, 255, 255]
    const present = snap.dark ? [90, 96, 110] : [176, 182, 194]
    const cx = { code: 0, col: 0, stats: null as ReturnType<typeof ctrl.stats.get> | null }

    // Precompute per-sampled-column conservation (threshold) when needed.
    let consByX: Float32Array | null = null
    if (overlay === 'conservation' && rows > 0 && cols > 0) {
      consByX = new Float32Array(W)
      const counts = newCounts()
      for (let x = 0; x < W; x++) {
        const col = Math.min(cols - 1, Math.floor((x / W) * cols))
        counts.fill(0)
        const total = countColumn((r) => store.residueAt(r, col), rows, counts)
        let max = 0
        for (let c = 1; c < counts.length; c++) if (counts[c] > max) max = counts[c]
        consByX[x] = total > 0 ? max / total : NaN
      }
    }
    const low = snap.dark ? [40, 44, 54] : [225, 228, 236]
    const high = snap.dark ? [45, 212, 191] : [13, 148, 136]

    for (let y = 0; y < H; y++) {
      const row = rows > 0 ? Math.min(rows - 1, Math.floor((y / H) * rows)) : 0
      for (let x = 0; x < W; x++) {
        const col = Math.min(cols - 1, Math.floor((x / W) * cols))
        const code = rows > 0 ? store.residueAt(row, col) : GAP_CODE
        const i = (y * W + x) * 4
        let r: number, g: number, b: number
        if (code === GAP_CODE) {
          ;[r, g, b] = bg
        } else if (overlay === 'clusters') {
          const hex = group?.colorOfVisualRow(row) ?? null
          if (hex) [r, g, b] = hexRGB(hex)
          else [r, g, b] = present
        } else if (overlay === 'conservation') {
          const s = consByX ? consByX[x] : NaN
          if (Number.isFinite(s)) {
            r = Math.round(low[0] + (high[0] - low[0]) * s)
            g = Math.round(low[1] + (high[1] - low[1]) * s)
            b = Math.round(low[2] + (high[2] - low[2]) * s)
          } else {
            ;[r, g, b] = present
          }
        } else {
          cx.code = code
          cx.col = col
          cx.stats = dynamic ? ctrl.stats.get(col) : null
          const c = scheme.bg(cx)
          if (c != null) {
            r = (c >> 16) & 0xff
            g = (c >> 8) & 0xff
            b = c & 0xff
          } else {
            ;[r, g, b] = present
          }
        }
        data[i] = r
        data[i + 1] = g
        data[i + 2] = b
        data[i + 3] = 255
      }
    }
    octx.putImageData(img, 0, 0)
    offRef.current = off
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.rows, snap.cols, snap.schemeId, snap.dark, W, H, contentVersion, overlay, groupsSig, consSig])

  const draw = () => {
    const canvas = canvasRef.current
    const off = offRef.current
    if (!canvas || !off) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    ctx.drawImage(off, 0, 0)
    const r = ctrl.renderer
    const totalW = ctrl.store.width * r.cellW
    const totalH = ctrl.store.height * r.cellH
    if (totalW <= 0 || totalH <= 0) return
    const rw = Math.max(6, (r.gridWidthPx / totalW) * W)
    const rh = Math.max(6, (r.gridHeightPx / totalH) * H)
    const x0 = Math.max(0, Math.min((r.scrollX / totalW) * W, W - rw))
    const y0 = Math.max(0, Math.min((r.scrollY / totalH) * H, H - rh))
    const x1 = Math.min(W, x0 + rw)
    const y1 = Math.min(H, y0 + rh)
    ctx.fillStyle = snap.dark ? 'rgba(6,7,10,0.58)' : 'rgba(20,24,32,0.42)'
    ctx.fillRect(0, 0, W, y0)
    ctx.fillRect(0, y1, W, H - y1)
    ctx.fillRect(0, y0, x0, y1 - y0)
    ctx.fillRect(x1, y0, W - x1, y1 - y0)
    const accent = snap.dark ? '#2dd4bf' : '#0d9488'
    ctx.fillStyle = snap.dark ? 'rgba(45,212,191,0.16)' : 'rgba(13,148,136,0.13)'
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2)
    ctx.strokeStyle = snap.dark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 1
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1)
  }

  useEffect(() => ctrl.renderer.addViewListener(draw))

  const navigate = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const fx = (e.clientX - rect.left) / W
    const fy = (e.clientY - rect.top) / H
    const r = ctrl.renderer
    r.setScroll(
      fx * ctrl.store.width * r.cellW - r.gridWidthPx / 2,
      fy * ctrl.store.height * r.cellH - r.gridHeightPx / 2,
    )
  }

  // +/- zoom the main grid scale (viewport box follows via the view listener).
  const zoom = (factor: number) => {
    const r = ctrl.renderer
    r.zoomAt(factor, r.gridWidthPx / 2 + 156, r.gridHeightPx / 2 + 22)
  }

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const sx = e.clientX
    const sy = e.clientY
    const sw = W
    const sh = H
    const move = (ev: PointerEvent) => {
      const w = Math.max(MIN_W, Math.min(MAX_W, sw - (ev.clientX - sx)))
      const h = Math.max(MIN_H, Math.min(MAX_H, sh - (ev.clientY - sy)))
      onResize(Math.round(w), Math.round(h))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const OVERLAYS: { id: Overlay; label: string; enabled: boolean }[] = [
    { id: 'residues', label: 'Res', enabled: true },
    { id: 'conservation', label: 'Cons', enabled: true },
    { id: 'clusters', label: 'Clust', enabled: !!group?.hasGroups() },
  ]

  return (
    <div className="minimap" style={{ width: W, height: H }}>
      <div className="mm-resize" title="Resize" onPointerDown={startResize} />
      <button className="mm-close" title="Hide overview" onClick={onClose}>
        ×
      </button>
      <div className="mm-chrome">
        <div className="mm-seg">
          {OVERLAYS.map((o) => (
            <button
              key={o.id}
              className={'mm-seg-btn' + (overlay === o.id ? ' active' : '')}
              disabled={!o.enabled}
              title={`${o.label} overlay`}
              onClick={() => setOverlay(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="mm-zoom">
          <button className="mm-seg-btn" title="Zoom out" onClick={() => zoom(1 / 1.3)}>
            −
          </button>
          <button className="mm-seg-btn" title="Zoom in" onClick={() => zoom(1.3)}>
            +
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          navigate(e)
        }}
        onPointerMove={(e) => {
          if (e.buttons) navigate(e)
        }}
      />
    </div>
  )
}
