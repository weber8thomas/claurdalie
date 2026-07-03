// Owns the active motif query: compiles the pattern, computes per-row matches,
// pushes the high-contrast overlay onto the grid, and drives Find Next/Prev.
// Implements SerializableModule so the query rides the active snapshot.
//
// Matches are keyed by STABLE row id (not visual index) so a pure reorder needs
// no recompute — only a composition change (getColumnsVersion) invalidates them,
// mirroring ConservationModel.

import type { EditorController } from '../../editor/EditorController'
import type { SerializableModule } from '../../project/types'
import { compilePattern, findMatches, type Compiled, type RowMatches } from './findpatterns'

interface MotifSlice {
  pattern: string
  matchIndex: number
  active: boolean
}

export class MotifModel implements SerializableModule<MotifSlice> {
  readonly sliceKey = 'motif'
  private pattern = ''
  private compiled: Compiled | null = null
  private byRowId = new Map<number, RowMatches>()
  private matchIndex = 0
  private active = false
  private error: string | null = null
  private listeners = new Set<() => void>()
  private unsub: () => void
  private lastColumnsVersion: number

  constructor(private ctrl: EditorController) {
    this.lastColumnsVersion = ctrl.getColumnsVersion()
    this.unsub = ctrl.subscribe(() => {
      const v = ctrl.getColumnsVersion()
      if (v !== this.lastColumnsVersion) {
        this.lastColumnsVersion = v
        if (this.pattern) {
          this.recompute()
          this.pushOverlay()
          this.emit()
        }
      }
    })
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  // ---- queries ------------------------------------------------------------

  getPattern(): string {
    return this.pattern
  }
  errorText(): string | null {
    return this.error
  }
  isActive(): boolean {
    return this.active
  }
  matchCount(): number {
    let n = 0
    for (const m of this.byRowId.values()) n += m.ranges.length
    return n
  }
  currentIndex(): number {
    return this.matchIndex
  }
  /** Aligned match ranges for a visual row (the provider handed to the renderer). */
  rangesOf(visualRow: number): Array<[number, number]> {
    const id = this.ctrl.store.rowIdAt(visualRow)
    return this.byRowId.get(id)?.ranges ?? []
  }

  // ---- commands -----------------------------------------------------------

  setPattern(src: string): void {
    this.pattern = src
    this.matchIndex = 0
    if (!src.trim()) {
      this.compiled = null
      this.byRowId.clear()
      this.error = null
      this.active = false
      this.pushOverlay()
      this.emit()
      return
    }
    this.compiled = compilePattern(src)
    if (!this.compiled.ok) {
      this.byRowId.clear()
      this.error = this.compiled.error
      this.active = false
      this.pushOverlay()
      this.emit()
      return
    }
    this.error = null
    this.recompute()
    this.active = this.matchCount() > 0
    this.pushOverlay()
    this.emit()
  }

  setActive(on: boolean): void {
    this.active = on && this.matchCount() > 0
    this.pushOverlay()
    this.emit()
  }

  clear(): void {
    this.setPattern('')
  }

  /** Ordered flat list of matches in current visual order: {row, col0}. */
  private flatMatches(): { row: number; col: number }[] {
    const out: { row: number; col: number }[] = []
    const h = this.ctrl.store.height
    for (let v = 0; v < h; v++) {
      const ranges = this.rangesOf(v)
      for (const [c0] of ranges) out.push({ row: v, col: c0 })
    }
    return out
  }

  findNext(): void {
    this.step(1)
  }
  findPrev(): void {
    this.step(-1)
  }
  private step(dir: number): void {
    const flat = this.flatMatches()
    if (!flat.length) return
    if (!this.active) this.setActive(true)
    this.matchIndex = ((this.matchIndex + dir) % flat.length + flat.length) % flat.length
    const t = flat[this.matchIndex]
    this.ctrl.scrollCellIntoView(t.row, t.col)
    this.emit()
  }

  private recompute(): void {
    this.byRowId.clear()
    if (!this.compiled || !this.compiled.ok) return
    const store = this.ctrl.store
    const h = store.height
    const rows: Uint8Array[] = []
    const ids: number[] = []
    for (let v = 0; v < h; v++) {
      const id = store.rowIdAt(v)
      ids.push(id)
      rows.push(store.materializeRow(id))
    }
    const results = findMatches(rows, this.compiled)
    for (let i = 0; i < ids.length; i++) this.byRowId.set(ids[i], results[i])
  }

  private pushOverlay(): void {
    this.ctrl.setMatchOverlay(
      this.active ? { rangesOf: (v) => this.rangesOf(v), active: true } : { rangesOf: (v) => this.rangesOf(v), active: false },
    )
  }

  // ---- SerializableModule -------------------------------------------------

  serialize(): MotifSlice {
    return { pattern: this.pattern, matchIndex: this.matchIndex, active: this.active }
  }
  hydrate(state: MotifSlice | undefined): void {
    this.setPattern(state?.pattern ?? '')
    if (state) {
      this.matchIndex = Math.min(Math.max(0, state.matchIndex), Math.max(0, this.matchCount() - 1))
      this.active = state.active && this.matchCount() > 0
      this.pushOverlay()
      this.emit()
    }
  }

  destroy(): void {
    this.unsub()
    this.ctrl.setMatchOverlay(null)
  }
}
