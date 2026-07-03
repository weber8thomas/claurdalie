// Turn an aligner's output into one undoable edit on the AlignmentStore.
//
// A re-alignment only decides where the GAPS go — residues are invariant. So we
// morph each affected row by deleting its current gaps then inserting the target
// gaps, reusing the existing invertible gap commands. Rows are matched by name;
// if the aligner reordered them, a ReorderBlockCommand repositions just those
// rows (stable for the rest). Everything is bundled into a single `sequence`, so
// a re-align is one undo entry (and one redo).

import type { AlignmentStore } from '../core/AlignmentStore'
import { GAP_CODE } from '../core/alphabet'
import type { EditCommand } from '../core/edits/EditCommand'
import { sequence } from '../core/edits/EditCommand'
import { DeleteGapCommand, InsertGapCommand, ReorderBlockCommand } from '../core/edits/commands'
import type { AlignedSeq } from './types'

/** Gap runs `[start, count]` within the first `len` columns of `codes`. */
function gapRuns(codes: Uint8Array, len: number): [number, number][] {
  const runs: [number, number][] = []
  let c = 0
  while (c < len) {
    if (codes[c] === GAP_CODE) {
      let n = 0
      while (c + n < len && codes[c + n] === GAP_CODE) n++
      runs.push([c, n])
      c += n
    } else {
      c++
    }
  }
  return runs
}

/** Commands that rebuild one row's gap layout to match `target`. */
function rebuildRowGapsCommands(store: AlignmentStore, rowId: number, target: Uint8Array): EditCommand[] {
  const out: EditCommand[] = []
  // 1. Remove every existing gap (right-to-left keeps earlier columns valid).
  const len = store.logicalLength(rowId)
  const current = store.materializeRow(rowId)
  const existing = gapRuns(current, len)
  for (let i = existing.length - 1; i >= 0; i--) {
    out.push(new DeleteGapCommand(rowId, existing[i][0], existing[i][1]))
  }
  // 2. Insert the target's gaps (left-to-right around the now-degapped residues).
  for (const [start, count] of gapRuns(target, target.length)) {
    out.push(new InsertGapCommand(rowId, start, count))
  }
  return out
}

/**
 * Build ONE undoable command that morphs the store's rows into `aligned`.
 * Unknown names (not in the store) are skipped. Returns a no-op `sequence` when
 * nothing matches.
 */
export function alignmentEdits(store: AlignmentStore, aligned: AlignedSeq[]): EditCommand {
  const cmds: EditCommand[] = []

  const nameToId = new Map<string, number>()
  for (const id of store.orderSnapshot()) {
    const name = store.getRow(id).name
    if (!nameToId.has(name)) nameToId.set(name, id)
  }

  // Reorder affected rows to the aligner's output order, leaving others in place.
  const alignedIds = aligned
    .map((a) => nameToId.get(a.name))
    .filter((x): x is number => x !== undefined)
  const affected = new Set(alignedIds)
  const before = store.orderSnapshot()
  const after = before.slice()
  const slots: number[] = []
  for (let i = 0; i < before.length; i++) if (affected.has(before[i])) slots.push(i)
  slots.forEach((slot, k) => (after[slot] = alignedIds[k]))
  if (after.some((id, i) => id !== before[i])) cmds.push(new ReorderBlockCommand(before, after))

  for (const a of aligned) {
    const rowId = nameToId.get(a.name)
    if (rowId === undefined) continue
    cmds.push(...rebuildRowGapsCommands(store, rowId, a.codes))
  }

  return sequence('Re-align', cmds)
}
