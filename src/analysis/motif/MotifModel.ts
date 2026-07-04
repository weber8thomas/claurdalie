// Owns the active motif query: compiles the pattern, computes per-row matches
// (off the main thread via the numerics worker), pushes the high-contrast overlay
// onto the grid, and drives Find Next/Prev. Implements SerializableModule so the
// query rides the active snapshot.
//
// Matches are keyed by STABLE row id (not visual index) so a pure reorder needs
// no recompute — only a composition change (getColumnsVersion) invalidates them,
// mirroring ConservationModel.
//
// Two highlight scopes: 'sequence' matches every row; 'group' (only meaningful
// when a clustering is active) matches ONE representative row per group, so a
// pattern over a grouping of thousands of sequences neither computes nor paints
// per-member — it collapses to a handful of representative highlights.

import type { EditorController } from '../../editor/EditorController'
import type { SerializableModule } from '../../project/types'
import { compilePattern, type Compiled, type RowMatches } from './findpatterns'
import { NumericsClient } from '../../workers/rpc'

export type MotifScope = 'sequence' | 'group'

/** Minimal view of a group the motif model needs (visual rows per group). */
export interface MotifGroup {
  rows: number[]
}

interface MotifSlice {
  pattern: string
  matchIndex: number
  active: boolean
  scope?: MotifScope
}

export class MotifModel implements SerializableModule<MotifSlice> {
  readonly sliceKey = 'motif'
  private pattern = ''
  private compiled: Compiled | null = null
  private byRowId = new Map<number, RowMatches>()
  private matchIndex = 0
  private active = false
  private error: string | null = null
  private scope: MotifScope = 'sequence'
  private computing = false
  private reqToken = 0
  private client = new NumericsClient()
  private groupProvider: (() => MotifGroup[]) | null = null
  private listeners = new Set<() => void>()
  private unsub: () => void
  private lastColumnsVersion: number

  constructor(private ctrl: EditorController) {
    this.lastColumnsVersion = ctrl.getColumnsVersion()
    this.unsub = ctrl.subscribe(() => {
      const v = ctrl.getColumnsVersion()
      if (v !== this.lastColumnsVersion) {
        this.lastColumnsVersion = v
        if (this.pattern) this.refresh({ keepActive: true })
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

  /** Supply the current grouping (visual-row subsets) for the group scope. */
  setGroupProvider(fn: (() => MotifGroup[]) | null): void {
    this.groupProvider = fn
  }

  /**
   * Notify that the grouping changed: the "Per group" toggle's visibility and the
   * group-scope match set both depend on it. Re-emit so the panel re-renders, and
   * recompute when we're actually painting per group.
   */
  onGroupsChanged(): void {
    if (this.scope === 'group' && this.compiled?.ok && this.pattern) this.refresh({ keepActive: true })
    else this.emit()
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
  isComputing(): boolean {
    return this.computing
  }
  getScope(): MotifScope {
    return this.scope
  }
  /** True when a grouping is active (so the per-group scope toggle is meaningful). */
  hasGroups(): boolean {
    return (this.groupProvider?.().length ?? 0) > 0
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
      this.computing = false
      this.reqToken++ // cancel any in-flight compute
      this.pushOverlay()
      this.emit()
      return
    }
    this.compiled = compilePattern(src)
    if (!this.compiled.ok) {
      this.byRowId.clear()
      this.error = this.compiled.error
      this.active = false
      this.computing = false
      this.reqToken++
      this.pushOverlay()
      this.emit()
      return
    }
    this.error = null
    this.refresh({ keepActive: false })
  }

  setActive(on: boolean): void {
    this.active = on && this.matchCount() > 0
    this.pushOverlay()
    this.emit()
  }

  setScope(scope: MotifScope): void {
    if (scope === this.scope) return
    this.scope = scope
    if (this.pattern && this.compiled?.ok) this.refresh({ keepActive: true })
    else this.emit()
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
    this.matchIndex = (((this.matchIndex + dir) % flat.length) + flat.length) % flat.length
    const t = flat[this.matchIndex]
    this.ctrl.scrollCellIntoView(t.row, t.col)
    this.emit()
  }

  /** Visual rows to run the pattern over: all rows, or one per group in group scope. */
  private targetRows(): number[] {
    const h = this.ctrl.store.height
    if (this.scope === 'group') {
      const groups = this.groupProvider?.() ?? []
      if (groups.length) {
        const reps: number[] = []
        for (const g of groups) if (g.rows.length) reps.push(g.rows[0])
        return reps
      }
    }
    return Array.from({ length: h }, (_, v) => v)
  }

  /**
   * Recompute matches off the main thread. `keepActive` preserves the current
   * active flag (composition change / scope change / hydrate); otherwise a fresh
   * pattern auto-activates when it has any match. Stale responses are dropped via
   * a monotonic request token.
   */
  private refresh(opts: { keepActive: boolean }): void {
    if (!this.compiled || !this.compiled.ok) return
    const token = ++this.reqToken
    const store = this.ctrl.store
    const rowsV = this.targetRows()
    const width = store.width
    const flat = new Uint8Array(rowsV.length * width)
    const ids: number[] = []
    for (let i = 0; i < rowsV.length; i++) {
      const id = store.rowIdAt(rowsV[i])
      ids.push(id)
      flat.set(store.materializeRow(id), i * width)
    }
    this.computing = true
    this.emit()
    void this.client
      .motif({ flat, nRows: rowsV.length, width, source: this.compiled.source })
      .then((res) => {
        if (token !== this.reqToken) return // superseded by a newer request
        this.byRowId.clear()
        for (let i = 0; i < ids.length; i++) this.byRowId.set(ids[i], res.matches[i])
        const count = this.matchCount()
        this.active = opts.keepActive ? this.active && count > 0 : count > 0
        this.matchIndex = Math.min(Math.max(0, this.matchIndex), Math.max(0, count - 1))
        this.computing = false
        this.pushOverlay()
        this.emit()
      })
      .catch(() => {
        if (token !== this.reqToken) return
        this.computing = false
        this.emit()
      })
  }

  private pushOverlay(): void {
    this.ctrl.setMatchOverlay({ rangesOf: (v) => this.rangesOf(v), active: this.active })
  }

  // ---- SerializableModule -------------------------------------------------

  serialize(): MotifSlice {
    return { pattern: this.pattern, matchIndex: this.matchIndex, active: this.active, scope: this.scope }
  }
  hydrate(state: MotifSlice | undefined): void {
    this.scope = state?.scope ?? 'sequence'
    // Set the intended active up front; refresh() clamps it against the fresh
    // match count once the (async) recompute lands.
    this.pattern = state?.pattern ?? ''
    this.matchIndex = state?.matchIndex ?? 0
    this.active = state?.active ?? false
    if (!this.pattern.trim()) {
      this.compiled = null
      this.byRowId.clear()
      this.error = null
      this.active = false
      this.reqToken++
      this.pushOverlay()
      this.emit()
      return
    }
    this.compiled = compilePattern(this.pattern)
    if (!this.compiled.ok) {
      this.byRowId.clear()
      this.error = this.compiled.error
      this.active = false
      this.reqToken++
      this.pushOverlay()
      this.emit()
      return
    }
    this.error = null
    this.refresh({ keepActive: true })
  }

  destroy(): void {
    this.unsub()
    this.reqToken++
    this.client.destroy()
    this.ctrl.setMatchOverlay(null)
  }
}
