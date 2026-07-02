import { CODE_TO_CHAR } from '../core/alphabet'
import { toCss, type RGB } from '../color/scheme'

/**
 * Pre-bakes residue glyphs into offscreen canvases (one per foreground color).
 * Rendering a cell's letter becomes a cheap drawImage blit instead of fillText.
 * Re-bake only when the cell size (font size) changes.
 */
export class GlyphAtlas {
  private atlases = new Map<RGB, HTMLCanvasElement>()
  private glyphW = 0
  private glyphH = 0
  private dpr = 1
  private fontPx = 0

  constructor(private fontFamily: string) {}

  /** Configure for a cell size; clears atlases if the font size changed. */
  configure(cellW: number, cellH: number, dpr: number): void {
    const fontPx = Math.round(Math.min(cellW, cellH) * 0.82)
    if (fontPx === this.fontPx && dpr === this.dpr) return
    this.fontPx = fontPx
    this.dpr = dpr
    this.glyphW = Math.ceil(cellW * dpr)
    this.glyphH = Math.ceil(cellH * dpr)
    this.atlases.clear()
  }

  get cellGlyphWidth(): number {
    return this.glyphW
  }
  get cellGlyphHeight(): number {
    return this.glyphH
  }

  /** Get (baking on demand) the atlas canvas for a foreground color. */
  atlas(color: RGB): HTMLCanvasElement {
    let a = this.atlases.get(color)
    if (!a) {
      a = this.bake(color)
      this.atlases.set(color, a)
    }
    return a
  }

  /** Source x of a residue code's glyph in the atlas. */
  glyphX(code: number): number {
    return code * this.glyphW
  }

  private bake(color: RGB): HTMLCanvasElement {
    const n = CODE_TO_CHAR.length
    const c = document.createElement('canvas')
    c.width = n * this.glyphW
    c.height = this.glyphH
    const ctx = c.getContext('2d')!
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${Math.round(this.fontPx * this.dpr)}px ${this.fontFamily}`
    ctx.fillStyle = toCss(color)
    for (let code = 1; code < n; code++) {
      const ch = CODE_TO_CHAR[code]
      if (ch === '-') continue
      ctx.fillText(ch, code * this.glyphW + this.glyphW / 2, this.glyphH / 2 + this.dpr)
    }
    return c
  }
}
