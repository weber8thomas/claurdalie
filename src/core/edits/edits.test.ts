import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { AlignmentStore } from '../AlignmentStore'
import { CODE_TO_CHAR, GAP_CODE } from '../alphabet'
import { parseFasta } from '../io/fasta'
import { UndoStack } from './EditCommand'
import {
  DeleteGapCommand,
  InsertGapCommand,
  ReorderRowsCommand,
  ShiftSequenceCommand,
  insertGapColumn,
} from './commands'

function makeStore(): AlignmentStore {
  const seqs = parseFasta(
    ['>a', 'MKV-LAG', '>b', 'MK-ILAG', '>c', 'MKVIL-G'].join('\n'),
  )
  return AlignmentStore.fromSequences(seqs)
}

/** Full grid as strings (visual order), for comparison. */
function grid(store: AlignmentStore): string[] {
  const out: string[] = []
  for (let v = 0; v < store.height; v++) {
    let s = ''
    for (let c = 0; c < store.width; c++) s += CODE_TO_CHAR[store.residueAt(v, c)]
    out.push(s)
  }
  return out
}

/** Ungapped sequence of a visual row. */
function ungapped(store: AlignmentStore, v: number): string {
  let s = ''
  for (let c = 0; c < store.width; c++) {
    const code = store.residueAt(v, c)
    if (code !== GAP_CODE) s += CODE_TO_CHAR[code]
  }
  return s
}

describe('edit commands round-trip', () => {
  it('insert gap then undo restores the grid', () => {
    const store = makeStore()
    const undo = new UndoStack(store)
    const before = grid(store)
    undo.do(new InsertGapCommand(store.rowIdAt(0), 2, 1))
    expect(grid(store)).not.toEqual(before)
    undo.undo()
    expect(grid(store)).toEqual(before)
  })

  it('delete gap only removes gaps and preserves residues', () => {
    const store = makeStore()
    const undo = new UndoStack(store)
    const seqBefore = ungapped(store, 1)
    undo.do(new DeleteGapCommand(store.rowIdAt(1), 2, 1))
    expect(ungapped(store, 1)).toEqual(seqBefore) // residues untouched
    undo.undo()
    expect(ungapped(store, 1)).toEqual(seqBefore)
  })

  it('shift sequence right then undo restores', () => {
    const store = makeStore()
    const undo = new UndoStack(store)
    const before = grid(store)
    const seq = ungapped(store, 0)
    undo.do(new ShiftSequenceCommand(store.rowIdAt(0), 3))
    expect(ungapped(store, 0)).toEqual(seq) // residues preserved
    undo.undo()
    expect(grid(store)).toEqual(before)
  })

  it('reorder rows then undo restores order', () => {
    const store = makeStore()
    const undo = new UndoStack(store)
    const names = () => Array.from({ length: store.height }, (_, v) => store.rowName(v))
    const before = names()
    undo.do(new ReorderRowsCommand(0, 2))
    expect(names()).not.toEqual(before)
    undo.undo()
    expect(names()).toEqual(before)
  })

  it('selection-scoped insert is a single undo entry', () => {
    const store = makeStore()
    const undo = new UndoStack(store)
    const before = grid(store)
    undo.do(insertGapColumn([store.rowIdAt(0), store.rowIdAt(1)], 1, 2))
    expect(undo.canUndo).toBe(true)
    undo.undo()
    expect(undo.canUndo).toBe(false) // one entry only
    expect(grid(store)).toEqual(before)
  })

  it('coalesced drag shifts collapse into one undo', () => {
    const store = makeStore()
    const undo = new UndoStack(store)
    const before = grid(store)
    const id = store.rowIdAt(0)
    for (let i = 0; i < 4; i++) undo.do(new ShiftSequenceCommand(id, 1, `shift:${id}`))
    undo.undo() // single undo reverts all four
    expect(grid(store)).toEqual(before)
    expect(undo.canUndo).toBe(false)
  })
})

describe('property: any sequence of gap edits preserves ungapped residues', () => {
  it('holds over random insert/delete/shift ops', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom('insert', 'delete', 'shift'),
            row: fc.nat(2),
            col: fc.nat(12),
            n: fc.integer({ min: 1, max: 3 }),
            dir: fc.constantFrom(-1, 1),
          }),
          { maxLength: 30 },
        ),
        (ops) => {
          const store = makeStore()
          const undo = new UndoStack(store)
          const baseline = [0, 1, 2].map((v) => ungapped(store, v))
          for (const op of ops) {
            const id = store.rowIdAt(op.row)
            if (op.kind === 'insert') undo.do(new InsertGapCommand(id, op.col, op.n))
            else if (op.kind === 'delete') undo.do(new DeleteGapCommand(id, op.col, op.n))
            else undo.do(new ShiftSequenceCommand(id, op.dir * op.n))
          }
          // Residues (ungapped) must be identical to the start for every row.
          for (let v = 0; v < 3; v++) {
            const id = store.rowIdAt(v)
            const originalIndex = store.orderSnapshot().indexOf(id)
            expect(ungapped(store, v)).toEqual(baseline[originalIndex])
          }
        },
      ),
      { numRuns: 200 },
    )
  })
})
