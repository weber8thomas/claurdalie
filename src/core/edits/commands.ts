import type { AlignmentStore } from '../AlignmentStore'
import type { ChangeSet } from '../types'
import type { EditCommand } from './EditCommand'
import { sequence } from './EditCommand'
import { deleteGapsInRow, gapRunLength, insertGapsInRow } from './rowedit'

// ---- insert gaps --------------------------------------------------------

export class InsertGapCommand implements EditCommand {
  label = 'Insert gap'
  coalesceKey?: string
  constructor(
    private rowId: number,
    private col: number,
    private count = 1,
    coalesceKey?: string,
  ) {
    this.coalesceKey = coalesceKey
  }
  apply(store: AlignmentStore): ChangeSet {
    const row = store.getRow(this.rowId)
    insertGapsInRow(row, this.col, this.count)
    const len = row.leadingGaps + row.codes.length + row.trailingGaps
    const layoutChanged = len > store.width
    if (layoutChanged) store.setWidth(len)
    return {
      rows: [this.rowId],
      columns: [this.col, store.width],
      layoutChanged,
    }
  }
  invert(): EditCommand {
    return new DeleteGapCommand(this.rowId, this.col, this.count)
  }
}

// ---- delete gaps --------------------------------------------------------

export class DeleteGapCommand implements EditCommand {
  label = 'Delete gap'
  coalesceKey?: string
  constructor(
    private rowId: number,
    private col: number,
    private count = 1,
    coalesceKey?: string,
  ) {
    this.coalesceKey = coalesceKey
  }
  apply(store: AlignmentStore): ChangeSet {
    const row = store.getRow(this.rowId)
    // Only remove actual gaps (protects residues); clamp count.
    const n = gapRunLength(row, this.col, this.count)
    if (n > 0) deleteGapsInRow(row, this.col, n)
    const layoutChanged = store.recomputeWidth()
    return {
      rows: [this.rowId],
      columns: [this.col, store.width + this.count],
      layoutChanged,
    }
  }
  invert(): EditCommand {
    return new InsertGapCommand(this.rowId, this.col, this.count)
  }
}

// ---- shift whole sequence ----------------------------------------------

/** Positive delta shifts residues right (adds leading gaps); negative shifts left. */
export class ShiftSequenceCommand implements EditCommand {
  label = 'Shift sequence'
  coalesceKey?: string
  private applied = 0
  constructor(
    private rowId: number,
    private delta: number,
    coalesceKey?: string,
  ) {
    this.coalesceKey = coalesceKey ?? `shift:${rowId}`
  }
  apply(store: AlignmentStore): ChangeSet {
    const row = store.getRow(this.rowId)
    let d = this.delta
    if (d < 0) d = -Math.min(-d, row.leadingGaps) // clamp left shift to available leading gaps
    row.leadingGaps += d
    this.applied = d
    let layoutChanged = false
    if (d > 0) {
      const len = row.leadingGaps + row.codes.length + row.trailingGaps
      if (len > store.width) {
        store.setWidth(len)
        layoutChanged = true
      }
    } else if (d < 0) {
      layoutChanged = store.recomputeWidth()
    }
    return { rows: [this.rowId], columns: [0, store.width], layoutChanged }
  }
  invert(): EditCommand {
    return new ShiftSequenceCommand(this.rowId, -this.applied)
  }
}

// ---- reorder rows -------------------------------------------------------

export class ReorderRowsCommand implements EditCommand {
  label = 'Reorder sequences'
  constructor(
    private from: number,
    private to: number,
  ) {}
  apply(store: AlignmentStore): ChangeSet {
    store.moveRow(this.from, this.to)
    return { orderChanged: true }
  }
  invert(): EditCommand {
    return new ReorderRowsCommand(this.to, this.from)
  }
}

/** Reorder by replacing the whole visual order (for multi-row block moves). */
export class ReorderBlockCommand implements EditCommand {
  label = 'Move sequences'
  constructor(
    private before: number[],
    private after: number[],
  ) {}
  apply(store: AlignmentStore): ChangeSet {
    store.setOrder(this.after)
    return { orderChanged: true }
  }
  invert(): EditCommand {
    return new ReorderBlockCommand(this.after, this.before)
  }
}

// ---- selection-scoped compound edits -----------------------------------

/** Insert `count` gap columns at `col` across the given rows (one undo entry). */
export function insertGapColumn(rowIds: number[], col: number, count = 1): EditCommand {
  return sequence(
    'Insert gap',
    rowIds.map((id) => new InsertGapCommand(id, col, count)),
  )
}

/** Delete `count` gap columns at `col` across the given rows (one undo entry). */
export function deleteGapColumn(rowIds: number[], col: number, count = 1): EditCommand {
  return sequence(
    'Delete gap',
    rowIds.map((id) => new DeleteGapCommand(id, col, count)),
  )
}
