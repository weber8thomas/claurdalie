import { ALPHABET_SIZE, GAP_CODE } from '../core/alphabet'
import { residueOf } from '../core/AlignmentStore'
import type { AlignmentStore } from '../core/AlignmentStore'
import type { ColumnStats, ColumnStatsCache } from '../core/stats/ColumnStats'
import { toCss, type ColorScheme, type RGB } from '../color/scheme'
import { GlyphAtlas } from './GlyphAtlas'
import { LIGHT_CANVAS, type CanvasTheme } from './theme'
import { clamp, computeVisible, maxScroll } from './viewport'

export const GUTTER_W = 156
export const RULER_H = 22
export const SB = 11 // scrollbar thickness
const TEXT_THRESHOLD = 6 // px/cell below which we stop drawing letters (block mode)

export interface ScrollbarHit {
  axis: 'h' | 'v'
  trackStart: number
  trackLen: number
  thumbStart: number
  thumbLen: number
  maxScroll: number
}

export interface CellPos {
  row: number
  col: number
}
export interface Selection {
  r0: number
  c0: number
  r1: number
  c1: number
}
export type HitRegion = 'grid' | 'gutter' | 'ruler' | 'corner'
export interface Hit {
  region: HitRegion
  row: number
  col: number
}

/**
 * High-performance Canvas 2D renderer for the alignment grid.
 *
 * Anti-flicker discipline:
 *  - one rAF loop, only paints when `dirty` (scroll/zoom/edit/selection).
 *  - opaque full-viewport background every frame (no partial/transparent frames).
 *  - scroll/zoom are imperative (setScroll/zoomAt) — never routed through React.
 *  - pixel-snapped cell coordinates; glyphs blitted from a pre-baked atlas.
 */
export class GridRenderer {
  private ctx: Canvas64
  private dpr = 1
  private cssW = 0
  private cssH = 0
  private atlas: GlyphAtlas
  private raf = 0
  private dirty = true
  // Offscreen buffer for the ImageData block-mode fast path.
  private blockCanvas?: HTMLCanvasElement
  private blockCtx?: CanvasRenderingContext2D
  private blockImage?: ImageData
  private blockColTable?: Uint32Array
  // Reused color-scheme context to avoid per-cell allocation in block mode.
  private bgCtx: { code: number; col: number; stats: ColumnStats | null } = { code: 0, col: 0, stats: null }

  // view state (mutated imperatively)
  scrollX = 0
  scrollY = 0
  cellW = 16
  cellH = 18
  scheme!: ColorScheme
  theme: CanvasTheme = LIGHT_CANVAS
  selection: Selection | null = null
  cursor: CellPos | null = null
  hover: CellPos | null = null
  gutterHoverRow: number | null = null
  dropIndex: number | null = null
  editMode = false

  constructor(
    private canvas: HTMLCanvasElement,
    private store: AlignmentStore,
    private stats: ColumnStatsCache,
    fontFamily: string,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false }) as unknown as Canvas64
    this.atlas = new GlyphAtlas(fontFamily)
    const loop = () => {
      if (this.dirty) {
        this.dirty = false
        this.paint()
      }
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
  }

  markDirty(): void {
    this.dirty = true
  }

  // Lightweight per-frame view notification (scroll/zoom) for the minimap etc.
  private viewListeners = new Set<() => void>()
  addViewListener(fn: () => void): () => void {
    this.viewListeners.add(fn)
    return () => this.viewListeners.delete(fn)
  }

  // ---- geometry -----------------------------------------------------------

  get gridWidthPx(): number {
    return Math.max(0, this.cssW - GUTTER_W)
  }
  get gridHeightPx(): number {
    return Math.max(0, this.cssH - RULER_H)
  }

  setSize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW
    this.cssH = cssH
    this.dpr = dpr
    this.canvas.width = Math.round(cssW * dpr)
    this.canvas.height = Math.round(cssH * dpr)
    this.canvas.style.width = cssW + 'px'
    this.canvas.style.height = cssH + 'px'
    this.clampScroll()
    this.dirty = true
  }

  setZoom(cellW: number, cellH: number): void {
    this.cellW = clamp(cellW, 0.25, 40)
    this.cellH = clamp(cellH, 0.25, 44)
    this.clampScroll()
    this.dirty = true
  }

  /** Zoom keeping the cell under (px,py) anchored. */
  zoomAt(factor: number, px: number, py: number): void {
    const gx = px - GUTTER_W
    const gy = py - RULER_H
    const colAt = (this.scrollX + gx) / this.cellW
    const rowAt = (this.scrollY + gy) / this.cellH
    const newW = clamp(this.cellW * factor, 0.25, 40)
    const newH = clamp(this.cellH * factor, 0.25, 44)
    this.cellW = newW
    this.cellH = newH
    this.scrollX = colAt * newW - gx
    this.scrollY = rowAt * newH - gy
    this.clampScroll()
    this.dirty = true
  }

  scrollBy(dx: number, dy: number): void {
    this.scrollX += dx
    this.scrollY += dy
    this.clampScroll()
    this.dirty = true
  }

  setScroll(x: number, y: number): void {
    this.scrollX = x
    this.scrollY = y
    this.clampScroll()
    this.dirty = true
  }

  private clampScroll(): void {
    const m = maxScroll({
      cols: this.store.width,
      rows: this.store.height,
      cellW: this.cellW,
      cellH: this.cellH,
      gridWidthPx: this.gridWidthPx,
      gridHeightPx: this.gridHeightPx,
    })
    this.scrollX = clamp(this.scrollX, 0, m.x)
    this.scrollY = clamp(this.scrollY, 0, m.y)
  }

  maxScroll(): { x: number; y: number } {
    return maxScroll({
      cols: this.store.width,
      rows: this.store.height,
      cellW: this.cellW,
      cellH: this.cellH,
      gridWidthPx: this.gridWidthPx,
      gridHeightPx: this.gridHeightPx,
    })
  }

  // ---- hit testing --------------------------------------------------------

  hitTest(px: number, py: number): Hit {
    const inGutter = px < GUTTER_W
    const inRuler = py < RULER_H
    const col = Math.floor((this.scrollX + (px - GUTTER_W)) / this.cellW)
    const row = Math.floor((this.scrollY + (py - RULER_H)) / this.cellH)
    let region: HitRegion
    if (inGutter && inRuler) region = 'corner'
    else if (inGutter) region = 'gutter'
    else if (inRuler) region = 'ruler'
    else region = 'grid'
    return { region, row, col }
  }

  /** Visual row index nearest a y pixel, for drag-reorder drop position. */
  dropIndexAt(py: number): number {
    const y = this.scrollY + (py - RULER_H)
    return clamp(Math.round(y / this.cellH), 0, this.store.height)
  }

  // ---- painting -----------------------------------------------------------

  private paint(): void {
    const ctx = this.ctx
    const S = this.dpr
    const t = this.theme
    ctx.setTransform(S, 0, 0, S, 0, 0)

    this.atlas.configure(this.cellW, this.cellH, S)

    // Background.
    ctx.fillStyle = toCss(t.gridBg)
    ctx.fillRect(0, 0, this.cssW, this.cssH)

    const vis = computeVisible({
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      cellW: this.cellW,
      cellH: this.cellH,
      gridWidthPx: this.gridWidthPx,
      gridHeightPx: this.gridHeightPx,
      rows: this.store.height,
      cols: this.store.width,
    })

    this.paintCells(vis)
    this.paintSelectionAndCursor()
    this.paintGutter(vis)
    this.paintRuler(vis)
    this.paintCorner()
    this.paintScrollbars()

    for (const fn of this.viewListeners) fn()
  }

  // ---- scrollbars ---------------------------------------------------------

  private hGeom(): ScrollbarHit | null {
    const contentW = this.store.width * this.cellW
    const view = this.gridWidthPx
    if (contentW <= view) return null
    const trackStart = GUTTER_W
    const trackLen = view
    const thumbLen = Math.max(28, (view / contentW) * trackLen)
    const maxScroll = contentW - view
    const thumbStart = trackStart + (this.scrollX / maxScroll) * (trackLen - thumbLen)
    return { axis: 'h', trackStart, trackLen, thumbStart, thumbLen, maxScroll }
  }
  private vGeom(): ScrollbarHit | null {
    const contentH = this.store.height * this.cellH
    const view = this.gridHeightPx
    if (contentH <= view) return null
    const trackStart = RULER_H
    const trackLen = view
    const thumbLen = Math.max(28, (view / contentH) * trackLen)
    const maxScroll = contentH - view
    const thumbStart = trackStart + (this.scrollY / maxScroll) * (trackLen - thumbLen)
    return { axis: 'v', trackStart, trackLen, thumbStart, thumbLen, maxScroll }
  }

  private paintScrollbars(): void {
    const ctx = this.ctx
    const t = this.theme
    const h = this.hGeom()
    const v = this.vGeom()
    const thumbCol = t.dark ? 'rgba(255,255,255,0.22)' : 'rgba(30,35,45,0.28)'
    if (h) {
      const y = this.cssH - SB
      ctx.fillStyle = toCss(t.gutterBg)
      ctx.fillRect(GUTTER_W, y, this.gridWidthPx, SB)
      ctx.fillStyle = thumbCol
      roundRect(ctx, h.thumbStart + 1, y + 2, h.thumbLen - 2, SB - 4, (SB - 4) / 2)
    }
    if (v) {
      const x = this.cssW - SB
      ctx.fillStyle = toCss(t.gutterBg)
      ctx.fillRect(x, RULER_H, SB, this.gridHeightPx)
      ctx.fillStyle = thumbCol
      roundRect(ctx, x + 2, v.thumbStart + 1, SB - 4, v.thumbLen - 2, (SB - 4) / 2)
    }
  }

  /** Hit-test a pixel against the scrollbars; returns geometry or null. */
  hitScrollbar(px: number, py: number): ScrollbarHit | null {
    const h = this.hGeom()
    if (h && py >= this.cssH - SB && px >= GUTTER_W) return h
    const v = this.vGeom()
    if (v && px >= this.cssW - SB && py >= RULER_H) return v
    return null
  }

  /** Set scroll so the thumb's start sits at `pos` pixels along its track. */
  scrollToThumb(bar: ScrollbarHit, pos: number): void {
    const frac = (pos - bar.trackStart) / (bar.trackLen - bar.thumbLen)
    const s = clamp(frac, 0, 1) * bar.maxScroll
    if (bar.axis === 'h') this.setScroll(s, this.scrollY)
    else this.setScroll(this.scrollX, s)
  }

  private cellX(col: number): number {
    return Math.round(GUTTER_W + col * this.cellW - this.scrollX)
  }
  private cellY(row: number): number {
    return Math.round(RULER_H + row * this.cellH - this.scrollY)
  }

  private paintCells(vis: ReturnType<typeof computeVisible>): void {
    const ctx = this.ctx
    const showText = this.cellW >= TEXT_THRESHOLD && this.cellH >= TEXT_THRESHOLD
    // Only pay for per-column consensus stats when we're actually drawing
    // glyphs. Zoomed out (block mode) we use static group colors — O(1)/cell.
    const useStats = this.scheme.dynamic && showText

    ctx.save()
    ctx.beginPath()
    ctx.rect(GUTTER_W, RULER_H, this.gridWidthPx, this.gridHeightPx)
    ctx.clip()

    if (showText) this.paintDetailed(vis, useStats)
    else this.paintBlockImage(vis)

    // Faint grid lines when cells are large enough to warrant them.
    if (this.cellW >= 10) {
      const bottom = Math.min(this.cssH, this.cellY(this.store.height))
      ctx.strokeStyle = toCss(this.theme.gridLine)
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.6
      ctx.beginPath()
      for (let c = vis.firstCol; c <= vis.lastCol; c++) {
        const x = this.cellX(c) + 0.5
        ctx.moveTo(x, RULER_H)
        ctx.lineTo(x, bottom)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    ctx.restore()
  }

  /** Detailed rendering: batched color runs + glyphs (used when zoomed in). */
  private paintDetailed(vis: ReturnType<typeof computeVisible>, useStats: boolean): void {
    const ctx = this.ctx
    const SENTINEL = -1 as unknown as RGB
    for (let v = vis.firstRow; v < vis.lastRow; v++) {
      const y = this.cellY(v)
      const h = this.cellY(v + 1) - y
      const row = this.store.getRow(this.store.rowIdAt(v))
      let runStart = vis.firstCol
      let runColor: RGB | null = SENTINEL
      for (let c = vis.firstCol; c <= vis.lastCol; c++) {
        let color: RGB | null = null
        if (c < vis.lastCol) {
          const code = residueOf(row, c)
          if (code !== GAP_CODE) {
            const stats = useStats ? this.stats.get(c) : null
            color = this.scheme.bg({ code, col: c, stats })
          }
        }
        if (color !== runColor) {
          if (runColor !== SENTINEL && runColor !== null && c > runStart) {
            const x = this.cellX(runStart)
            ctx.fillStyle = toCss(runColor)
            ctx.fillRect(x, y, this.cellX(c) - x, h)
          }
          runStart = c
          runColor = color
        }
      }
    }
    const dw = this.cellW
    const dh = this.cellH
    const gw = this.atlas.cellGlyphWidth
    const gh = this.atlas.cellGlyphHeight
    for (let v = vis.firstRow; v < vis.lastRow; v++) {
      const y = this.cellY(v)
      const row = this.store.getRow(this.store.rowIdAt(v))
      for (let c = vis.firstCol; c < vis.lastCol; c++) {
        const code = residueOf(row, c)
        if (code === GAP_CODE) continue
        const stats = useStats ? this.stats.get(c) : null
        const fg = this.scheme.fg({ code, col: c, stats })
        const atlas = this.atlas.atlas(fg)
        ctx.drawImage(atlas as unknown as CanvasImageSource, this.atlas.glyphX(code), 0, gw, gh, this.cellX(c), y, dw, dh)
      }
    }
  }

  /**
   * Block-mode fast path: rasterize the visible grid into an ImageData buffer
   * (one write per screen pixel, not per cell) and blit it in a single call.
   * This is what keeps extreme zoom-out on huge alignments smooth.
   */
  private paintBlockImage(vis: ReturnType<typeof computeVisible>): void {
    void vis
    const W = Math.max(1, Math.ceil(this.gridWidthPx))
    const H = Math.max(1, Math.ceil(this.gridHeightPx))
    if (!this.blockCanvas) {
      this.blockCanvas = document.createElement('canvas')
      this.blockCtx = this.blockCanvas.getContext('2d')!
    }
    const bc = this.blockCanvas
    const bctx = this.blockCtx!
    if (bc.width !== W || bc.height !== H) {
      bc.width = W
      bc.height = H
      this.blockImage = undefined
    }
    if (!this.blockImage) this.blockImage = bctx.createImageData(W, H)
    const img = this.blockImage
    const buf = new Uint32Array(img.data.buffer)

    const gridU32 = packABGR(this.theme.gridBg)
    const cw = this.cellW
    const ch = this.cellH
    const rows = this.store.height
    const cols = this.store.width
    const K = ALPHABET_SIZE
    // Map each pixel to a column once (incremental — no per-pixel divide).
    const colAt = new Int32Array(W)
    let cf = this.scrollX / cw
    const cstep = 1 / cw
    for (let px = 0; px < W; px++) {
      const c = cf | 0
      colAt[px] = c < cols ? c : -1
      cf += cstep
    }
    const rstep = 1 / ch

    if (this.scheme.dynamic) {
      // Consensus-gated coloring, consistent with the zoomed-in view: a per
      // pixel-column color table built from cached column stats.
      if (!this.blockColTable || this.blockColTable.length < W * K) this.blockColTable = new Uint32Array(W * K)
      const colTable = this.blockColTable
      const cx = this.bgCtx
      for (let px = 0; px < W; px++) {
        const col = colAt[px]
        if (col < 0) continue
        const base = px * K
        cx.col = col
        cx.stats = this.stats.get(col)
        colTable[base + GAP_CODE] = gridU32
        for (let code = 1; code < K; code++) {
          cx.code = code
          const c = this.scheme.bg(cx)
          colTable[base + code] = c == null ? gridU32 : packABGR(c)
        }
      }
      let rf = this.scrollY / ch
      for (let py = 0; py < H; py++) {
        const r = rf | 0
        rf += rstep
        const rowBase = py * W
        if (r >= rows) {
          buf.fill(gridU32, rowBase, rowBase + W)
          continue
        }
        const row = this.store.getRow(this.store.rowIdAt(r))
        for (let px = 0; px < W; px++) {
          const col = colAt[px]
          buf[rowBase + px] = col < 0 ? gridU32 : colTable[px * K + residueOf(row, col)]
        }
      }
    } else {
      // Static scheme: one column-independent color per residue code.
      const table = new Uint32Array(K)
      table[GAP_CODE] = gridU32
      const cx = this.bgCtx
      cx.col = 0
      cx.stats = null
      for (let code = 1; code < K; code++) {
        cx.code = code
        const c = this.scheme.bg(cx)
        table[code] = c == null ? gridU32 : packABGR(c)
      }
      let rf = this.scrollY / ch
      for (let py = 0; py < H; py++) {
        const r = rf | 0
        rf += rstep
        const base = py * W
        if (r >= rows) {
          buf.fill(gridU32, base, base + W)
          continue
        }
        const row = this.store.getRow(this.store.rowIdAt(r))
        for (let px = 0; px < W; px++) {
          const c = colAt[px]
          buf[base + px] = c < 0 ? gridU32 : table[residueOf(row, c)]
        }
      }
    }
    bctx.putImageData(img, 0, 0)
    const ctx = this.ctx
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(bc as unknown as CanvasImageSource, GUTTER_W, RULER_H, W, H)
    ctx.imageSmoothingEnabled = true
  }

  private paintSelectionAndCursor(): void {
    const ctx = this.ctx
    ctx.save()
    ctx.beginPath()
    ctx.rect(GUTTER_W, RULER_H, this.gridWidthPx, this.gridHeightPx)
    ctx.clip()

    // Hover crosshair.
    if (this.hover) {
      ctx.fillStyle = toCss(this.theme.hover)
      ctx.globalAlpha = 0.12
      const hx = this.cellX(this.hover.col)
      ctx.fillRect(hx, RULER_H, this.cellW, this.gridHeightPx)
      const hy = this.cellY(this.hover.row)
      ctx.fillRect(GUTTER_W, hy, this.gridWidthPx, this.cellH)
      ctx.globalAlpha = 1
    }

    // Selection rectangle.
    if (this.selection) {
      const s = this.normSelection(this.selection)
      const x = this.cellX(s.c0)
      const y = this.cellY(s.r0)
      const w = this.cellX(s.c1 + 1) - x
      const h = this.cellY(s.r1 + 1) - y
      ctx.fillStyle = toCss(this.theme.selection)
      ctx.globalAlpha = 0.16
      ctx.fillRect(x, y, w, h)
      ctx.globalAlpha = 1
      ctx.strokeStyle = toCss(this.theme.selection)
      ctx.lineWidth = 1.5
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    }

    // Cursor cell.
    if (this.cursor) {
      const x = this.cellX(this.cursor.col)
      const y = this.cellY(this.cursor.row)
      ctx.strokeStyle = toCss(this.theme.cursor)
      ctx.lineWidth = 2
      ctx.strokeRect(x + 1, y + 1, this.cellW - 2, this.cellH - 2)
    }
    ctx.restore()
  }

  private normSelection(s: Selection): Selection {
    return {
      r0: Math.min(s.r0, s.r1),
      r1: Math.max(s.r0, s.r1),
      c0: Math.min(s.c0, s.c1),
      c1: Math.max(s.c0, s.c1),
    }
  }

  private paintGutter(vis: ReturnType<typeof computeVisible>): void {
    const ctx = this.ctx
    const t = this.theme
    ctx.fillStyle = toCss(t.gutterBg)
    ctx.fillRect(0, RULER_H, GUTTER_W, this.cssH - RULER_H)

    const sel = this.selection ? this.normSelection(this.selection) : null
    // Names use the SAME visibility threshold as residue glyphs, with a font
    // that scales down with the row height so both fade out together.
    const showNames = this.cellW >= TEXT_THRESHOLD && this.cellH >= TEXT_THRESHOLD
    const showGrip = this.cellH >= 14 && this.editMode // grips only when rows are draggable
    if (showNames) {
      const fontPx = Math.max(8, Math.min(13, Math.round(this.cellH * 0.72)))
      ctx.textBaseline = 'middle'
      ctx.font = `${fontPx}px system-ui, sans-serif`
      const nameX = showGrip ? 26 : 8
      for (let v = vis.firstRow; v < vis.lastRow; v++) {
        const y = this.cellY(v)
        if (sel && v >= sel.r0 && v <= sel.r1) {
          ctx.fillStyle = toCss(t.selection)
          ctx.globalAlpha = 0.14
          ctx.fillRect(0, y, GUTTER_W, this.cellH)
          ctx.globalAlpha = 1
        }
        const hovered = v === this.gutterHoverRow
        if (hovered) {
          ctx.fillStyle = toCss(t.hover)
          ctx.globalAlpha = 0.16
          ctx.fillRect(0, y, GUTTER_W, this.cellH)
          ctx.globalAlpha = 1
        }
        // Drag handle (grip dots) — brighter on hover to signal draggability.
        if (showGrip) this.drawGrip(9, y + this.cellH / 2, hovered ? t.text : t.mutedText, hovered ? 0.9 : 0.4)
        ctx.fillStyle = toCss(t.text)
        const name = this.store.rowName(v)
        ctx.fillText(this.ellipsize(name, GUTTER_W - nameX - 6), nameX, y + this.cellH / 2, GUTTER_W - nameX - 6)
      }
    } else if (sel) {
      // Zoomed out: mark the selected row band as a single rect (no text).
      const y = this.cellY(sel.r0)
      const yEnd = this.cellY(sel.r1 + 1)
      ctx.fillStyle = toCss(t.selection)
      ctx.globalAlpha = 0.25
      ctx.fillRect(0, y, GUTTER_W, Math.max(1, yEnd - y))
      ctx.globalAlpha = 1
    }

    // Drag-reorder drop indicator.
    if (this.dropIndex !== null) {
      const y = this.cellY(this.dropIndex)
      ctx.strokeStyle = toCss(t.dropLine)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(this.cssW, y)
      ctx.stroke()
    }

    // Gutter right border.
    ctx.strokeStyle = toCss(t.gridLine)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(GUTTER_W + 0.5, RULER_H)
    ctx.lineTo(GUTTER_W + 0.5, this.cssH)
    ctx.stroke()
  }

  private drawGrip(cx: number, cy: number, color: RGB, alpha: number): void {
    if (this.cellH < 12) return
    const ctx = this.ctx
    ctx.fillStyle = toCss(color)
    ctx.globalAlpha = alpha
    const r = 1.15
    for (let i = -1; i <= 1; i++) {
      for (const dx of [-2.5, 2.5]) {
        ctx.beginPath()
        ctx.arc(cx + dx, cy + i * 4.5, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  private ellipsize(s: string, maxPx: number): string {
    if (this.ctx.measureText(s).width <= maxPx) return s
    let lo = 0,
      hi = s.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.ctx.measureText(s.slice(0, mid) + '…').width <= maxPx) lo = mid
      else hi = mid - 1
    }
    return s.slice(0, lo) + '…'
  }

  private paintRuler(vis: ReturnType<typeof computeVisible>): void {
    const ctx = this.ctx
    const t = this.theme
    ctx.fillStyle = toCss(t.rulerBg)
    ctx.fillRect(GUTTER_W, 0, this.cssW - GUTTER_W, RULER_H)

    ctx.save()
    ctx.beginPath()
    ctx.rect(GUTTER_W, 0, this.cssW - GUTTER_W, RULER_H)
    ctx.clip()
    ctx.fillStyle = toCss(t.mutedText)
    ctx.strokeStyle = toCss(t.gridLine)
    ctx.font = `10px system-ui, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    const step = tickStep(this.cellW)
    const start = Math.max(1, Math.floor(vis.firstCol / step) * step)
    ctx.beginPath()
    for (let c = start; c < vis.lastCol; c += step) {
      const x = this.cellX(c - 1) + this.cellW / 2
      ctx.fillText(String(c), x, RULER_H / 2)
      ctx.moveTo(Math.round(x) + 0.5, RULER_H - 4)
      ctx.lineTo(Math.round(x) + 0.5, RULER_H)
    }
    ctx.stroke()
    ctx.textAlign = 'left'
    // Bottom border.
    ctx.strokeStyle = toCss(t.gridLine)
    ctx.beginPath()
    ctx.moveTo(GUTTER_W, RULER_H + 0.5)
    ctx.lineTo(this.cssW, RULER_H + 0.5)
    ctx.stroke()
    ctx.restore()
  }

  private paintCorner(): void {
    const ctx = this.ctx
    ctx.fillStyle = toCss(this.theme.rulerBg)
    ctx.fillRect(0, 0, GUTTER_W, RULER_H)
    ctx.strokeStyle = toCss(this.theme.gridLine)
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, GUTTER_W, RULER_H)
  }
}

/** Pack an 0xRRGGBB color into little-endian ABGR uint32 for ImageData. */
function packABGR(rgb: number): number {
  const r = (rgb >> 16) & 0xff
  const g = (rgb >> 8) & 0xff
  const b = rgb & 0xff
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.fill()
}

function tickStep(cellW: number): number {
  const targetPx = 55
  const raw = targetPx / cellW
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000, 2500, 5000]
  for (const s of steps) if (s >= raw) return s
  return 10000
}

// The 2D context type with the few methods we use; keeps TS happy across libs.
type Canvas64 = CanvasRenderingContext2D
