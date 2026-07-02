import { useEffect, useRef } from 'react'
import type { EditorController } from '../editor/EditorController'
import { useEditorSnapshot } from './useEditor'
import { SCHEME_LUTS } from '../color/schemes'
import { GAP_CODE } from '../core/alphabet'

const MIN_W = 120
const MIN_H = 80
const MAX_W = 460
const MAX_H = 340

interface Props {
  ctrl: EditorController
  width: number
  height: number
  onResize: (w: number, h: number) => void
  onClose: () => void
}

export function Minimap({ ctrl, width, height, onResize, onClose }: Props) {
  const snap = useEditorSnapshot(ctrl)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const offRef = useRef<HTMLCanvasElement | null>(null)
  const W = width
  const H = height

  // Rebuild the downsampled heatmap when data / scheme / theme / size change.
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
    const lut = SCHEME_LUTS[snap.schemeId]
    const bg = snap.dark ? [26, 27, 32] : [255, 255, 255]
    const present = snap.dark ? [120, 130, 150] : [150, 160, 175]
    for (let y = 0; y < H; y++) {
      const row = rows > 0 ? Math.min(rows - 1, Math.floor((y / H) * rows)) : 0
      for (let x = 0; x < W; x++) {
        const col = Math.min(cols - 1, Math.floor((x / W) * cols))
        const code = rows > 0 ? store.residueAt(row, col) : GAP_CODE
        const i = (y * W + x) * 4
        let r: number, g: number, b: number
        if (code === GAP_CODE) {
          ;[r, g, b] = bg
        } else {
          const c = lut?.[code]
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
  }, [snap.rows, snap.cols, snap.schemeId, snap.dark, W, H])

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
    const accent = snap.dark ? '#7aa2ff' : '#2f6df6'
    ctx.fillStyle = snap.dark ? 'rgba(122,162,255,0.14)' : 'rgba(47,109,246,0.12)'
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

  // Corner handle (top-left) resizes; anchored bottom-right so it grows outward.
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

  return (
    <div className="minimap" style={{ width: W, height: H }}>
      <div className="mm-resize" title="Resize" onPointerDown={startResize} />
      <button className="mm-close" title="Hide minimap" onClick={onClose}>
        ×
      </button>
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
