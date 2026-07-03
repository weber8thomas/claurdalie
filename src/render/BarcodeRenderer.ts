// Draws a "barcode" per cluster (Ordalie §4.13) onto a sibling canvas,
// column-aligned with the alignment grid. One stacked lane per group; within a
// lane each column gets a vertical bar whose height encodes conservation, plus a
// gap-density tick and an optional feature (motif) mark. Pure imperative drawing
// (React never touches a residue): it reads geometry (cellW/scrollX/gridWidthPx)
// straight from the GridRenderer so bars stay aligned at any zoom/scroll.

import { GUTTER_W } from './GridRenderer'

export interface BarcodeLane {
  name: string
  color: string
  /** Per-column conservation 0..100 (NaN = too few residues). length === colCount. */
  conservation: Float32Array
  /** Per-column gap fraction 0..1. length === colCount. */
  gap: Float32Array
  /** Optional per-column feature flag (e.g. motif match present). */
  feature?: Uint8Array
}

export interface BarcodeTheme {
  bg: string
  label: string
  grid: string
  gap: string
  feature: string
}
export const LIGHT_BARCODE: BarcodeTheme = { bg: '#fbfbfd', label: '#54545c', grid: '#e6e6ec', gap: '#c3c7d1', feature: '#ef4444' }
export const DARK_BARCODE: BarcodeTheme = { bg: '#181820', label: '#a0a0ac', grid: '#2a2a34', gap: '#3a3f4c', feature: '#f87171' }

export interface BarcodeDrawParams {
  cellW: number
  scrollX: number
  gridWidthPx: number
  colCount: number
  theme: BarcodeTheme
  lanes: BarcodeLane[]
}

const LANE_GAP = 3
const LANE_PAD = 4

export class BarcodeRenderer {
  private ctx: CanvasRenderingContext2D
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
  }

  resize(cssW: number, cssH: number): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    this.canvas.width = Math.max(1, Math.round(cssW * dpr))
    this.canvas.height = Math.max(1, Math.round(cssH * dpr))
    this.canvas.style.width = `${cssW}px`
    this.canvas.style.height = `${cssH}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  draw(p: BarcodeDrawParams): void {
    const ctx = this.ctx
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const W = this.canvas.width / dpr
    const H = this.canvas.height / dpr
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = p.theme.bg
    ctx.fillRect(0, 0, W, H)

    const n = p.lanes.length
    if (n === 0) {
      ctx.fillStyle = p.theme.label
      ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace"
      ctx.textBaseline = 'middle'
      ctx.fillText('Cluster the alignment to see per-group barcodes', 8, H / 2)
      return
    }

    const laneH = (H - LANE_GAP * (n - 1)) / n
    const first = Math.max(0, Math.floor(p.scrollX / p.cellW))
    const last = Math.min(p.colCount - 1, first + Math.ceil(p.gridWidthPx / p.cellW) + 1)

    ctx.font = "10px 'JetBrains Mono', ui-monospace, monospace"
    ctx.textBaseline = 'middle'

    for (let li = 0; li < n; li++) {
      const lane = p.lanes[li]
      const top = li * (laneH + LANE_GAP)
      const bottom = top + laneH
      const plotTop = top + LANE_PAD
      const plotBot = bottom - LANE_PAD
      const plotH = Math.max(1, plotBot - plotTop)

      // Lane label in the gutter.
      ctx.fillStyle = lane.color
      ctx.fillRect(4, top + 3, 4, laneH - 6)
      ctx.fillStyle = p.theme.label
      ctx.fillText(ellipsize(ctx, lane.name, GUTTER_W - 18), 12, top + laneH / 2)

      // Baseline.
      ctx.strokeStyle = p.theme.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(GUTTER_W, Math.round(plotBot) + 0.5)
      ctx.lineTo(GUTTER_W + p.gridWidthPx, Math.round(plotBot) + 0.5)
      ctx.stroke()

      if (last < first) continue

      // Clip to the grid area so bars don't spill into the gutter/scrollbar.
      ctx.save()
      ctx.beginPath()
      ctx.rect(GUTTER_W, top, p.gridWidthPx, laneH)
      ctx.clip()

      const barW = Math.max(1, p.cellW - (p.cellW >= 4 ? 1 : 0))
      for (let c = first; c <= last; c++) {
        const x = GUTTER_W + c * p.cellW - p.scrollX
        // Conservation bar (tall = conserved).
        const s = lane.conservation[c]
        if (Number.isFinite(s) && s > 0) {
          const h = (s / 100) * plotH
          ctx.fillStyle = lane.color
          ctx.globalAlpha = 0.35 + 0.55 * (s / 100)
          ctx.fillRect(x, plotBot - h, barW, h)
          ctx.globalAlpha = 1
        }
        // Gap-density tick from the top edge.
        const g = lane.gap[c]
        if (g > 0.001) {
          ctx.fillStyle = p.theme.gap
          ctx.globalAlpha = 0.7
          ctx.fillRect(x, plotTop, barW, Math.max(1, g * (plotH * 0.35)))
          ctx.globalAlpha = 1
        }
        // Feature mark (e.g. motif match).
        if (lane.feature && lane.feature[c]) {
          ctx.fillStyle = p.theme.feature
          ctx.fillRect(x, plotBot - 3, barW, 3)
        }
      }
      ctx.restore()
    }
  }
}

function ellipsize(ctx: CanvasRenderingContext2D, s: string, maxPx: number): string {
  if (ctx.measureText(s).width <= maxPx) return s
  let out = s
  while (out.length > 1 && ctx.measureText(out + '…').width > maxPx) out = out.slice(0, -1)
  return out + '…'
}
