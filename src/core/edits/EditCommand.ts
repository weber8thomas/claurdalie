import type { AlignmentStore } from '../AlignmentStore'
import type { ChangeSet } from '../types'

/** An invertible edit. apply() returns what changed; invert() yields the undo. */
export interface EditCommand {
  apply(store: AlignmentStore): ChangeSet
  invert(): EditCommand
  label: string
  /** Same-key consecutive commands are merged into one undo entry (e.g. a drag). */
  coalesceKey?: string
}

/**
 * Undo/redo history. Applying a command pushes it; undo replays its inverse.
 * Consecutive commands sharing a `coalesceKey` collapse into a single entry so
 * one drag / one keyboard repeat = one undo.
 */
export class UndoStack {
  private undoStack: EditCommand[] = []
  private redoStack: EditCommand[] = []
  private onChange?: () => void

  constructor(private store: AlignmentStore) {}

  setOnChange(fn: () => void): void {
    this.onChange = fn
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null
  }
  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null
  }

  /** Apply a command, record it for undo, and notify. */
  do(cmd: EditCommand): ChangeSet {
    const change = cmd.apply(this.store)
    const prev = this.undoStack.at(-1)
    if (prev && cmd.coalesceKey && prev.coalesceKey === cmd.coalesceKey) {
      // Keep the earliest command's inverse target by replacing the visible
      // command but preserving the original inverse chain: we store a compound
      // inverse by keeping the first command's invert and applying this one on
      // top. Simplest correct approach: keep both inverses via a merged entry.
      this.undoStack[this.undoStack.length - 1] = mergeCoalesced(prev, cmd)
    } else {
      this.undoStack.push(cmd)
    }
    this.redoStack.length = 0
    this.store.emitChange(change)
    this.onChange?.()
    return change
  }

  undo(): void {
    const cmd = this.undoStack.pop()
    if (!cmd) return
    const inv = cmd.invert()
    const change = inv.apply(this.store)
    this.redoStack.push(cmd)
    this.store.emitChange(change)
    this.onChange?.()
  }

  redo(): void {
    const cmd = this.redoStack.pop()
    if (!cmd) return
    const change = cmd.apply(this.store)
    this.undoStack.push(cmd)
    this.store.emitChange(change)
    this.onChange?.()
  }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.onChange?.()
  }
}

/**
 * Merge two coalescing commands (both already applied) into one undo entry.
 * As a `sequence`, its invert() undoes both in reverse and its apply() (redo)
 * re-applies both in order. Nesting a third command keeps this correct.
 */
function mergeCoalesced(first: EditCommand, second: EditCommand): EditCommand {
  return sequence(first.label, [first, second], first.coalesceKey)
}

/** Build a command that applies a list of commands in order (and inverts in reverse). */
export function sequence(label: string, cmds: EditCommand[], coalesceKey?: string): EditCommand {
  return {
    label,
    coalesceKey,
    apply(store: AlignmentStore): ChangeSet {
      return mergeChanges(cmds.map((c) => c.apply(store)))
    },
    invert(): EditCommand {
      return sequence(label, cmds.map((c) => c.invert()).reverse())
    },
  }
}

/** Combine several ChangeSets into one. */
export function mergeChanges(changes: ChangeSet[]): ChangeSet {
  const rows = new Set<number>()
  let colLo = Infinity
  let colHi = -Infinity
  let layoutChanged = false
  let orderChanged = false
  for (const c of changes) {
    c.rows?.forEach((r) => rows.add(r))
    if (c.columns) {
      colLo = Math.min(colLo, c.columns[0])
      colHi = Math.max(colHi, c.columns[1])
    }
    layoutChanged ||= !!c.layoutChanged
    orderChanged ||= !!c.orderChanged
  }
  const out: ChangeSet = {}
  if (rows.size) out.rows = [...rows]
  if (colHi >= colLo) out.columns = [colLo, colHi]
  if (layoutChanged) out.layoutChanged = true
  if (orderChanged) out.orderChanged = true
  return out
}
