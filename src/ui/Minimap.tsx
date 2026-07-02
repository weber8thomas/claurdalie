import { useEffect, useRef } from 'react'
import type { EditorController } from '../editor/EditorController'
import { useEditorSnapshot } from './useEditor'
import { SCHEME_LUTS } from '../color/schemes'
import { GAP_CODE } from '../core/alphabet'

const MMW = 180
const MMH = 120

export function Minimap({ ctrl }: { ctrl: EditorController }) {
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
    const rx = (r.scrollX / totalW) * MMW
    const ry = (r.scrollY / totalH) * MMH
    const rw = Math.max(4, (r.gridWidthPx / totalW) * MMW)
    const rh = Math.max(4, (r.gridHeightPx / totalH) * MMH)
    ctx.strokeStyle = snap.dark ? '#5b8dff' : '#2f6df6'
    ctx.lineWidth = 1.5
    ctx.strokeRect(rx + 0.5, ry + 0.5, Math.min(rw, MMW - rx), Math.min(rh, MMH - ry))
    ctx.fillStyle = snap.dark ? 'rgba(91,141,255,0.12)' : 'rgba(47,109,246,0.12)'
    ctx.fillRect(rx, ry, Math.min(rw, MMW - rx), Math.min(rh, MMH - ry))
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
