import { GAP_CODE, residueChar } from '../core/alphabet'
import { AlignmentStore } from '../core/AlignmentStore'
import { ColumnStatsCache } from '../core/stats/ColumnStats'
import { UndoStack } from '../core/edits/EditCommand'
import { sequence } from '../core/edits/EditCommand'
import {
  DeleteGapCommand,
  InsertGapCommand,
  ReorderRowsCommand,
  ShiftSequenceCommand,
  deleteGapColumn,
  insertGapColumn,
} from '../core/edits/commands'
import { parseFasta, serializeFasta, type ParsedSequence } from '../core/io/fasta'
import { buildSchemes, DEFAULT_SCHEME_ID } from '../color/schemes'
import type { ColorScheme } from '../color/scheme'
import { GridRenderer, type CellPos, type Selection } from '../render/GridRenderer'
import { DARK_CANVAS, LIGHT_CANVAS } from '../render/theme'

const MONO = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace"

export interface EditorSnapshot {
  rows: number
  cols: number
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  cursor: CellPos | null
  cursorResidue: string | null
  cursorResidueIndex: number | null // 1-based ungapped position, null on gap
  selection: Selection | null
  schemeId: string
  dark: boolean
  cursorMode: boolean
  cellW: number
}

/**
 * Central non-React hub: owns the model, undo stack, stats cache and renderer,
 * exposes edit operations, and publishes a snapshot for the React chrome.
 */
export class EditorController {
  store = new AlignmentStore()
  stats = new ColumnStatsCache(this.store)
  undo = new UndoStack(this.store)
  renderer: GridRenderer

  private schemes: ColorScheme[]
  private dark = matchesDark()
  schemeId = DEFAULT_SCHEME_ID
  cursorMode = false

  private listeners = new Set<() => void>()
  private version = 0

  constructor(canvas: HTMLCanvasElement) {
    this.schemes = buildSchemes(this.dark)
    this.renderer = new GridRenderer(canvas, this.store, this.stats, MONO)
    this.renderer.scheme = this.scheme()
    this.renderer.theme = this.dark ? DARK_CANVAS : LIGHT_CANVAS

    // Model events drive cache invalidation + repaint.
    this.store.on('rowsChanged', (c) => {
      if (c.columns) this.stats.invalidate(c.columns[0], c.columns[1] + 1)
      this.renderer.markDirty()
    })
    this.store.on('layoutChanged', () => this.renderer.markDirty())
    this.store.on('orderChanged', () => {
      this.stats.clear()
      this.renderer.markDirty()
    })
    this.store.on('reset', () => {
      this.stats.clear()
      this.renderer.setScroll(0, 0)
      this.renderer.markDirty()
    })
    this.undo.setOnChange(() => this.bump())
  }

  scheme(): ColorScheme {
    return this.schemes.find((s) => s.id === this.schemeId) ?? this.schemes[0]
  }

  // ---- subscription -------------------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = (): number => this.version
  /** Public trigger for imperative actions (e.g. wheel zoom) to refresh chrome. */
  snapshotBump = (): void => this.bump()
  private bump(): void {
    this.version++
    for (const fn of this.listeners) fn()
  }

  snapshot(): EditorSnapshot {
    const cur = this.renderer.cursor
    let residue: string | null = null
    let residueIndex: number | null = null
    if (cur && cur.row < this.store.height && cur.col < this.store.width) {
      const code = this.store.residueAt(cur.row, cur.col)
      residue = code === GAP_CODE ? '-' : residueChar(code)
      residueIndex = code === GAP_CODE ? null : this.ungappedIndex(cur.row, cur.col)
    }
    return {
      rows: this.store.height,
      cols: this.store.width,
      canUndo: this.undo.canUndo,
      canRedo: this.undo.canRedo,
      undoLabel: this.undo.undoLabel,
      cursor: cur,
      cursorResidue: residue,
      cursorResidueIndex: residueIndex,
      selection: this.renderer.selection,
      schemeId: this.schemeId,
      dark: this.dark,
      cursorMode: this.cursorMode,
      cellW: this.renderer.cellW,
    }
  }

  /** 1-based count of non-gap residues up to and including `col` in a visual row. */
  private ungappedIndex(v: number, col: number): number {
    let n = 0
    for (let c = 0; c <= col; c++) if (this.store.residueAt(v, c) !== GAP_CODE) n++
    return n
  }

  // ---- loading / export ---------------------------------------------------

  loadSequences(seqs: ParsedSequence[]): void {
    this.store.load(seqs)
    this.undo.clear()
    this.renderer.cursor = null
    this.renderer.selection = null
    this.bump()
  }
  loadFasta(text: string): void {
    this.loadSequences(parseFasta(text))
  }
  exportFasta(): string {
    return serializeFasta(this.store.toSequences())
  }

  /** FASTA of a single visual row. */
  rowFasta(v: number): string {
    const id = this.store.rowIdAt(v)
    return serializeFasta([{ name: this.store.getRow(id).name, codes: this.store.materializeRow(id) }])
  }

  /** FASTA of the current selection rectangle, or null if no selection. */
  selectionFasta(): string | null {
    const sel = this.renderer.selection
    if (!sel) return null
    const r0 = Math.min(sel.r0, sel.r1)
    const r1 = Math.max(sel.r0, sel.r1)
    const c0 = Math.min(sel.c0, sel.c1)
    const c1 = Math.max(sel.c0, sel.c1)
    const seqs = []
    for (let v = r0; v <= r1; v++) {
      const id = this.store.rowIdAt(v)
      const full = this.store.materializeRow(id)
      seqs.push({ name: this.store.getRow(id).name, codes: full.slice(c0, c1 + 1) })
    }
    return serializeFasta(seqs)
  }

  isInSelection(v: number, c: number): boolean {
    const s = this.renderer.selection
    if (!s) return false
    return (
      v >= Math.min(s.r0, s.r1) &&
      v <= Math.max(s.r0, s.r1) &&
      c >= Math.min(s.c0, s.c1) &&
      c <= Math.max(s.c0, s.c1)
    )
  }

  /** Remove every column that is a gap in all sequences (one undo entry). */
  removeGapOnlyColumns(): number {
    const w = this.store.width
    const h = this.store.height
    const cols: number[] = []
    for (let c = 0; c < w; c++) {
      let allGap = true
      for (let v = 0; v < h; v++) {
        if (this.store.residueAt(v, c) !== GAP_CODE) {
          allGap = false
          break
        }
      }
      if (allGap) cols.push(c)
    }
    if (!cols.length) return 0
    const ids = this.store.orderSnapshot()
    // Delete right-to-left so earlier column indices stay valid.
    const cmds = []
    for (let i = cols.length - 1; i >= 0; i--) cmds.push(deleteGapColumn(ids, cols[i], 1))
    this.undo.do(sequence('Remove gap-only columns', cmds))
    return cols.length
  }

  // ---- appearance ---------------------------------------------------------

  setSchemeId(id: string): void {
    this.schemeId = id
    this.renderer.scheme = this.scheme()
    this.renderer.markDirty()
    this.bump()
  }
  setDark(dark: boolean): void {
    this.dark = dark
    this.schemes = buildSchemes(dark)
    this.renderer.scheme = this.scheme()
    this.renderer.theme = dark ? DARK_CANVAS : LIGHT_CANVAS
    this.renderer.markDirty()
    this.bump()
  }
  toggleCursorMode(): void {
    this.cursorMode = !this.cursorMode
    if (this.cursorMode && !this.renderer.cursor) {
      this.renderer.cursor = { row: 0, col: 0 }
    }
    this.renderer.markDirty()
    this.bump()
  }

  // ---- cursor / selection -------------------------------------------------

  private selectionAnchor: CellPos | null = null

  setCursor(row: number, col: number, extend = false): void {
    const r = clampInt(row, 0, this.store.height - 1)
    const c = clampInt(col, 0, this.store.width - 1)
    if (extend) {
      if (!this.selectionAnchor) this.selectionAnchor = this.renderer.cursor ?? { row: r, col: c }
      const a = this.selectionAnchor
      this.renderer.selection = { r0: a.row, c0: a.col, r1: r, c1: c }
    } else {
      this.selectionAnchor = null
      this.renderer.selection = null
    }
    this.renderer.cursor = { row: r, col: c }
    this.renderer.markDirty()
    this.bump()
  }
  moveCursor(dRow: number, dCol: number, extend = false): void {
    const c = this.renderer.cursor ?? { row: 0, col: 0 }
    this.setCursor(c.row + dRow, c.col + dCol, extend)
    this.ensureCursorVisible()
  }
  selectAll(): void {
    if (this.store.height === 0) return
    this.setSelection({ r0: 0, c0: 0, r1: this.store.height - 1, c1: this.store.width - 1 })
  }
  zoomBy(factor: number): void {
    this.renderer.zoomAt(factor, this.renderer.gridWidthPx / 2 + 156, this.renderer.gridHeightPx / 2 + 22)
    this.bump()
  }
  resetZoom(): void {
    this.renderer.setZoom(16, 18)
    this.bump()
  }
  scrollPage(dir: number): void {
    this.renderer.scrollBy(0, dir * this.renderer.gridHeightPx * 0.9)
  }
  setSelection(sel: Selection | null): void {
    this.renderer.selection = sel
    this.renderer.markDirty()
    this.bump()
  }
  setHover(h: CellPos | null): void {
    this.renderer.hover = h
    this.renderer.markDirty()
  }
  setGutterHover(row: number | null): void {
    this.renderer.gutterHoverRow = row
    this.renderer.markDirty()
  }

  /** Residue char + ungapped position for a cell (for the hover tooltip). */
  describeCell(v: number, c: number): { char: string; ungapped: number | null } {
    const code = this.store.residueAt(v, c)
    if (code === GAP_CODE) return { char: '-', ungapped: null }
    return { char: residueChar(code), ungapped: this.ungappedIndex(v, c) }
  }
  clearSelection(): void {
    this.setSelection(null)
  }

  private ensureCursorVisible(): void {
    const c = this.renderer.cursor
    if (!c) return
    const r = this.renderer
    const x = c.col * r.cellW
    const y = c.row * r.cellH
    let nx = r.scrollX
    let ny = r.scrollY
    if (x < r.scrollX) nx = x
    else if (x + r.cellW > r.scrollX + r.gridWidthPx) nx = x + r.cellW - r.gridWidthPx
    if (y < r.scrollY) ny = y
    else if (y + r.cellH > r.scrollY + r.gridHeightPx) ny = y + r.cellH - r.gridHeightPx
    r.setScroll(nx, ny)
  }

  // ---- editing ------------------------------------------------------------

  /** Rows the current edit targets: selected visual rows, else the cursor row. */
  private targetRowIds(): { ids: number[]; col: number } | null {
    const sel = this.renderer.selection
    if (sel) {
      const r0 = Math.min(sel.r0, sel.r1)
      const r1 = Math.max(sel.r0, sel.r1)
      const col = Math.min(sel.c0, sel.c1)
      const ids: number[] = []
      for (let v = r0; v <= r1; v++) ids.push(this.store.rowIdAt(v))
      return { ids, col }
    }
    const cur = this.renderer.cursor
    if (!cur) return null
    return { ids: [this.store.rowIdAt(cur.row)], col: cur.col }
  }

  insertGap(): void {
    const t = this.targetRowIds()
    if (!t) return
    const hadSelection = !!this.renderer.selection
    this.undo.do(t.ids.length > 1 ? insertGapColumn(t.ids, t.col, 1) : new InsertGapCommand(t.ids[0], t.col, 1))
    // Single-cell typing advances the cursor; a selection is kept intact so you
    // can keep editing the same block (Space/Delete don't reset it).
    if (!hadSelection && this.renderer.cursor) {
      this.setCursor(this.renderer.cursor.row, this.renderer.cursor.col + 1)
    }
  }
  deleteGap(): void {
    const t = this.targetRowIds()
    if (!t) return
    this.undo.do(t.ids.length > 1 ? deleteGapColumn(t.ids, t.col, 1) : new DeleteGapCommand(t.ids[0], t.col, 1))
  }
  /** Delete the gap immediately to the LEFT (backspace behavior). */
  deleteGapLeft(): void {
    const cur = this.renderer.cursor
    if (!cur || cur.col === 0) return
    this.undo.do(new DeleteGapCommand(this.store.rowIdAt(cur.row), cur.col - 1, 1))
    this.moveCursor(0, -1)
  }
  shiftTargets(delta: number): void {
    const t = this.targetRowIds()
    if (!t) return
    const key = `shift:${t.ids.join(',')}`
    if (t.ids.length === 1) {
      this.undo.do(new ShiftSequenceCommand(t.ids[0], delta, key))
    } else {
      this.undo.do(
        sequence(
          'Shift sequences',
          t.ids.map((id) => new ShiftSequenceCommand(id, delta)),
          key,
        ),
      )
    }
  }
  /** Move a visual row up/down by `delta` positions, keeping it highlighted and in view. */
  moveRowBy(v: number, delta: number): void {
    const to = clampInt(v + delta, 0, this.store.height - 1)
    if (to === v) return
    this.undo.do(new ReorderRowsCommand(v, to))
    this.selectRow(to)
  }

  /** Highlight a whole visual row (track) and scroll it into view vertically. */
  selectRow(v: number): void {
    if (v < 0 || v >= this.store.height) return
    const col = this.renderer.cursor?.col ?? 0
    this.renderer.cursor = { row: v, col: clampInt(col, 0, Math.max(0, this.store.width - 1)) }
    this.renderer.selection = { r0: v, c0: 0, r1: v, c1: Math.max(0, this.store.width - 1) }
    this.selectionAnchor = null
    this.ensureRowVisible(v)
    this.renderer.markDirty()
    this.bump()
  }

  private ensureRowVisible(v: number): void {
    const r = this.renderer
    const y = v * r.cellH
    let ny = r.scrollY
    if (y < r.scrollY) ny = y
    else if (y + r.cellH > r.scrollY + r.gridHeightPx) ny = y + r.cellH - r.gridHeightPx
    r.setScroll(r.scrollX, ny)
  }

  /** Shift explicit rows (used by shift-drag), coalesced under `key`. */
  shiftRowsById(ids: number[], delta: number, key: string): void {
    if (delta === 0 || ids.length === 0) return
    if (ids.length === 1) {
      this.undo.do(new ShiftSequenceCommand(ids[0], delta, key))
    } else {
      this.undo.do(
        sequence('Shift sequences', ids.map((id) => new ShiftSequenceCommand(id, delta)), key),
      )
    }
  }
  reorder(from: number, to: number): void {
    if (from === to) return
    // splice semantics: dropping below its own position shifts the target down by 1
    const adjusted = to > from ? to - 1 : to
    this.undo.do(new ReorderRowsCommand(from, adjusted))
    this.selectRow(adjusted)
  }

  undoAction(): void {
    this.undo.undo()
  }
  redoAction(): void {
    this.undo.redo()
  }

  destroy(): void {
    this.renderer.destroy()
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
function matchesDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}
