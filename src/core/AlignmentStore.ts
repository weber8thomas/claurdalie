import { GAP_CODE } from './alphabet'
import type { ChangeSet, Row, StoreEvent, StoreListener } from './types'

/**
 * The in-memory alignment model. Framework-agnostic (no React, no DOM).
 *
 * Design goals:
 *  - O(1) whole-sequence shift (leading/trailing gap offsets).
 *  - O(1) row reorder (a permutation, never moves residue data).
 *  - Fine-grained change events so the renderer repaints minimally.
 *
 * The renderer subscribes to events; it never re-renders through React.
 */
export class AlignmentStore {
  private rowsById = new Map<number, Row>()
  /** order[visualIndex] = rowId */
  private order: number[] = []
  private listeners = new Map<StoreEvent, Set<StoreListener>>()

  private _width = 0
  private nextId = 1

  // ---- construction -------------------------------------------------------

  static fromSequences(seqs: { name: string; codes: Uint8Array }[]): AlignmentStore {
    const store = new AlignmentStore()
    store.load(seqs)
    return store
  }

  /** Replace all content. Emits `reset`. */
  load(seqs: { name: string; codes: Uint8Array }[]): void {
    this.rowsById.clear()
    this.order = []
    this.nextId = 1
    let width = 0
    for (const s of seqs) {
      const row: Row = {
        id: this.nextId++,
        name: s.name,
        codes: s.codes,
        leadingGaps: 0,
        trailingGaps: 0,
      }
      this.rowsById.set(row.id, row)
      this.order.push(row.id)
      width = Math.max(width, s.codes.length)
    }
    // Normalize trailing gaps so every row has the same logical width.
    this._width = width
    for (const row of this.rowsById.values()) {
      row.trailingGaps = width - (row.leadingGaps + row.codes.length)
    }
    this.emit('reset', {})
  }

  // ---- accessors ----------------------------------------------------------

  get width(): number {
    return this._width
  }
  get height(): number {
    return this.order.length
  }

  /** rowId at a visual index (respecting reorder). */
  rowIdAt(visualIndex: number): number {
    return this.order[visualIndex]
  }

  getRow(id: number): Row {
    const r = this.rowsById.get(id)
    if (!r) throw new Error(`no row ${id}`)
    return r
  }

  rowName(visualIndex: number): string {
    return this.getRow(this.order[visualIndex]).name
  }

  /** Residue code at a logical (visual row, column) position. */
  residueAt(visualIndex: number, col: number): number {
    const row = this.getRow(this.order[visualIndex])
    return residueOf(row, col)
  }

  /** Residue code by row id. */
  residueOfRow(rowId: number, col: number): number {
    return residueOf(this.getRow(rowId), col)
  }

  logicalLength(rowId: number): number {
    const r = this.getRow(rowId)
    return r.leadingGaps + r.codes.length + r.trailingGaps
  }

  /** Snapshot of visual order as row ids (copy). */
  orderSnapshot(): number[] {
    return this.order.slice()
  }

  // ---- low-level mutation (used by edit commands) -------------------------
  // These do NOT emit events or push undo; the command layer orchestrates that.

  /** Recompute width from all rows; returns true if it changed. */
  recomputeWidth(): boolean {
    let w = 0
    for (const r of this.rowsById.values()) {
      w = Math.max(w, r.leadingGaps + r.codes.length + r.trailingGaps)
    }
    const changed = w !== this._width
    this._width = w
    return changed
  }

  setWidth(w: number): void {
    this._width = w
  }

  /** Move the row at `from` visual index to `to`. Mutates order in place. */
  moveRow(from: number, to: number): void {
    if (from === to) return
    const [id] = this.order.splice(from, 1)
    this.order.splice(to, 0, id)
  }

  setOrder(ids: number[]): void {
    this.order = ids.slice()
  }

  // ---- events -------------------------------------------------------------

  on(event: StoreEvent, fn: StoreListener): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(fn)
    return () => set!.delete(fn)
  }

  emit(event: StoreEvent, change: ChangeSet): void {
    const set = this.listeners.get(event)
    if (set) for (const fn of set) fn(change)
  }

  /** Emit a change derived from a ChangeSet, firing the relevant events. */
  emitChange(change: ChangeSet): void {
    if (change.rows && change.rows.length) this.emit('rowsChanged', change)
    if (change.orderChanged) this.emit('orderChanged', change)
    if (change.layoutChanged) this.emit('layoutChanged', change)
  }

  // ---- serialization helpers ---------------------------------------------

  /** Materialize a full row (including leading/trailing gaps) into a Uint8Array. */
  materializeRow(rowId: number): Uint8Array {
    const r = this.getRow(rowId)
    const out = new Uint8Array(this._width)
    // leading gaps are already 0
    out.set(r.codes, r.leadingGaps)
    // trailing already 0
    return out
  }

  /** Iterate rows in visual order as { name, codes(full width) }. */
  toSequences(): { name: string; codes: Uint8Array }[] {
    return this.order.map((id) => ({
      name: this.getRow(id).name,
      codes: this.materializeRow(id),
    }))
  }
}

/** Residue code of a row at a logical column, honoring gap offsets. */
export function residueOf(row: Row, col: number): number {
  if (col < row.leadingGaps) return GAP_CODE
  const idx = col - row.leadingGaps
  if (idx < row.codes.length) return row.codes[idx]
  return GAP_CODE
}
