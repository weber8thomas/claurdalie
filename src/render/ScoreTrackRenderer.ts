// Draws conservation score tracks onto a sibling canvas, column-aligned with the
// alignment grid. Pure imperative canvas drawing (React never touches a residue):
// it reads geometry (cellW, scrollX, gridWidthPx) straight from the GridRenderer
// so bars stay pixel-aligned with columns at every zoom and scroll offset.

import { GUTTER_W } from './GridRenderer'
import type { ConservationMethodId, ScoreTrack } from '../analysis/conservation/types'

/** Distinct per-method line colors (shared brand palette, extended). */
export const METHOD_COLORS: Record<ConservationMethodId, string> = {
  threshold: '#2bb3a3',
  shannon: '#5b7cf0',
  jsd: '#f3a83c',
  meanDistance: '#ef5d6c',
  vectorNorm: '#8b5cf6',
  bild: '#22c55e',
  liu: '#eab308',
  multi: '#ec4899',
}

export interface TrackTheme {
  bg: string
  axis: string
  label: string
  grid: string
}
export const LIGHT_TRACK: TrackTheme = { bg: '#fbfbfd', axis: '#1a1a1e', label: '#54545c', grid: '#e6e6ec' }
export const DARK_TRACK: TrackTheme = { bg: '#181820', axis: '#e8e8ea', label: '#a0a0ac', grid: '#2a2a34' }

export interface TrackInput {
  method: ConservationMethodId
  track: ScoreTrack
  color: string
  /** Emphasized (global) track drawn thicker/filled. */
  emphasis?: boolean
}

export interface DrawParams {
  cellW: number
  scrollX: number
  gridWidthPx: number
  colCount: number
  theme: TrackTheme
  tracks: TrackInput[]
}

export class ScoreTrackRenderer {
  private ctx: CanvasRenderingContext2D
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
  }

  /** Size to a CSS box, accounting for devicePixelRatio. */
  resize(cssW: number, cssH: number): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    this.canvas.width = Math.max(1, Math.round(cssW * dpr))
    this.canvas.height = Math.max(1, Math.round(cssH * dpr))
    this.canvas.style.width = `${cssW}px`
    this.canvas.style.height = `${cssH}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  draw(p: DrawParams): void {
    const ctx = this.ctx
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const W = this.canvas.width / dpr
    const H = this.canvas.height / dpr
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = p.theme.bg
    ctx.fillRect(0, 0, W, H)

    const padTop = 6
    const padBot = 14
    const plotH = Math.max(1, H - padTop - padBot)
    const base = H - padBot

    // Horizontal reference lines at 0/50/100.
    ctx.strokeStyle = p.theme.grid
    ctx.lineWidth = 1
    for (const frac of [0, 0.5, 1]) {
      const y = Math.round(base - frac * plotH) + 0.5
      ctx.beginPath()
      ctx.moveTo(GUTTER_W, y)
      ctx.lineTo(GUTTER_W + p.gridWidthPx, y)
      ctx.stroke()
    }

    // Visible column window.
    const first = Math.max(0, Math.floor(p.scrollX / p.cellW))
    const last = Math.min(p.colCount - 1, first + Math.ceil(p.gridWidthPx / p.cellW) + 1)
    if (last < first || p.tracks.length === 0) {
      this.legend(p, W)
      return
    }

    // Clip to the grid area so bars don't spill into the gutter/scrollbar.
    ctx.save()
    ctx.beginPath()
    ctx.rect(GUTTER_W, 0, p.gridWidthPx, H)
    ctx.clip()

    for (const t of p.tracks) {
      const scores = t.track.scores
      ctx.strokeStyle = t.color
      ctx.fillStyle = t.color
      const asBars = p.cellW >= 4 && p.tracks.length === 1
      if (asBars) {
        // Solid bars when there's room and a single track.
        ctx.globalAlpha = 0.85
        for (let c = first; c <= last; c++) {
          const s = scores[c]
          if (!Number.isFinite(s)) continue
          const x = GUTTER_W + c * p.cellW - p.scrollX
          const h = (s / 100) * plotH
          ctx.fillRect(x + 0.5, base - h, Math.max(1, p.cellW - 1), h)
        }
        ctx.globalAlpha = 1
      } else {
        // Polyline for dense views or overlaid multiple methods.
        ctx.lineWidth = t.emphasis ? 2 : 1.25
        ctx.beginPath()
        let started = false
        for (let c = first; c <= last; c++) {
          const s = scores[c]
          const x = GUTTER_W + c * p.cellW - p.scrollX + p.cellW / 2
          if (!Number.isFinite(s)) {
            started = false
            continue
          }
          const y = base - (s / 100) * plotH
          if (!started) {
            ctx.moveTo(x, y)
            started = true
          } else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    }
    ctx.restore()
    this.legend(p, W)
  }

  private legend(p: DrawParams, W: number): void {
    const ctx = this.ctx
    ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace"
    ctx.textBaseline = 'middle'
    // Left gutter: axis caption.
    ctx.fillStyle = p.theme.label
    ctx.fillText('conservation', 8, 12)
    // Right-aligned per-method swatches.
    let x = W - 8
    for (let i = p.tracks.length - 1; i >= 0; i--) {
      const t = p.tracks[i]
      const label = t.method
      const tw = ctx.measureText(label).width
      x -= tw
      ctx.fillStyle = p.theme.label
      ctx.fillText(label, x, 12)
      x -= 8
      ctx.fillStyle = t.color
      ctx.fillRect(x - 8, 8, 8, 8)
      x -= 16
    }
  }
}
