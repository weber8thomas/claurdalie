import { useEffect, useRef } from 'react'
import type { EditorController } from '../editor/EditorController'
import { useEditorSnapshot } from './useEditor'
import { SCHEME_LUTS } from '../color/schemes'
import { GAP_CODE } from '../core/alphabet'

const MMW = 180
const MMH = 120

export function Minimap({ ctrl, onClose }: { ctrl: EditorController; onClose: () => void }) {
  const snap = useEditorSnapshot(ctrl)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const offRef = useRef<HTMLCanvasElement | null>(null)

  // Rebuild the downsampled heatmap when data / scheme / theme change.
  useEffect(() => {
    const off = document.createElement('canvas')
    off.width = MMW
    off.height = MMH
    const octx = off.getContext('2d')!
    const img = octx.createImageData(MMW, MMH)
    const data = img.data
    const { store } = ctrl
    const rows = store.height
    const cols = store.width
    const lut = SCHEME_LUTS[snap.schemeId]
    const bg = snap.dark ? [26, 27, 32] : [255, 255, 255]
    const present = snap.dark ? [120, 130, 150] : [150, 160, 175]
    for (let y = 0; y < MMH; y++) {
      const row = Math.min(rows - 1, Math.floor((y / MMH) * rows))
      for (let x = 0; x < MMW; x++) {
        const col = Math.min(cols - 1, Math.floor((x / MMW) * cols))
        const code = rows > 0 ? store.residueAt(row, col) : GAP_CODE
        const i = (y * MMW + x) * 4
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
  }, [snap.rows, snap.cols, snap.schemeId, snap.dark])

  const draw = () => {
    const canvas = canvasRef.current
    const off = offRef.current
    if (!canvas || !off) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, MMW, MMH)
    ctx.drawImage(off, 0, 0)
    // viewport rectangle
    const r = ctrl.renderer
    const totalW = ctrl.store.width * r.cellW
    const totalH = ctrl.store.height * r.cellH
    if (totalW <= 0 || totalH <= 0) return
    const rw = Math.max(6, (r.gridWidthPx / totalW) * MMW)
    const rh = Math.max(6, (r.gridHeightPx / totalH) * MMH)
    const x0 = Math.max(0, Math.min((r.scrollX / totalW) * MMW, MMW - rw))
    const y0 = Math.max(0, Math.min((r.scrollY / totalH) * MMH, MMH - rh))
    const x1 = Math.min(MMW, x0 + rw)
    const y1 = Math.min(MMH, y0 + rh)
    // Dim everything outside the current viewport so the location pops.
    ctx.fillStyle = snap.dark ? 'rgba(6,7,10,0.58)' : 'rgba(20,24,32,0.42)'
    ctx.fillRect(0, 0, MMW, y0)
    ctx.fillRect(0, y1, MMW, MMH - y1)
    ctx.fillRect(0, y0, x0, y1 - y0)
    ctx.fillRect(x1, y0, MMW - x1, y1 - y0)
    // Bright border + subtle inner tint on the viewport rectangle.
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

  // Redraw the viewport rectangle whenever the grid view changes (scroll/zoom).
  useEffect(() => ctrl.renderer.addViewListener(draw))

  const navigate = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const fx = (e.clientX - rect.left) / MMW
    const fy = (e.clientY - rect.top) / MMH
    const r = ctrl.renderer
    r.setScroll(
      fx * ctrl.store.width * r.cellW - r.gridWidthPx / 2,
      fy * ctrl.store.height * r.cellH - r.gridHeightPx / 2,
    )
  }

  return (
    <div className="minimap" style={{ width: MMW, height: MMH }}>
      <button className="mm-close" title="Hide minimap" onClick={onClose}>
        ×
      </button>
      <canvas
        ref={canvasRef}
        width={MMW}
        height={MMH}
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
