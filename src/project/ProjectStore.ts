// In-memory manager of Snapshots ("instances") with instant switching.
//
// The active snapshot's alignment IS the live AlignmentStore; other snapshots
// keep their captured sequences + module slices in memory (v0.4 keeps them all
// hydrated — IndexedDB lazy-loading is a v0.7 concern). Switching:
//   1. capture the live editor + every registered module into the active snapshot
//   2. load the target snapshot's sequences into the store
//   3. hydrate every registered module from the target's slices
// so no analytical state is lost when juggling between instances.

import type { SnapshotSequence, SerializableModule, Snapshot, SnapshotInfo } from './types'

/**
 * The minimal editor surface ProjectStore needs — decoupled from the full
 * EditorController (and its canvas) so the spine is unit-testable.
 */
export interface ProjectHost {
  captureSequences(): SnapshotSequence[]
  loadSequences(seqs: SnapshotSequence[]): void
  sequenceCount(): number
  columnCount(): number
}

export class ProjectStore {
  private snapshots: Snapshot[] = []
  private activeId = 0
  private nextId = 1
  private modules: SerializableModule[] = []
  private listeners = new Set<() => void>()

  constructor(private ctrl: ProjectHost) {}

  /** Register a sub-module so its state travels with each snapshot. */
  register(mod: SerializableModule): void {
    this.modules.push(mod)
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  // ---- lifecycle ----------------------------------------------------------

  /** Seed the project from the currently-loaded alignment as the first snapshot. */
  init(name = 'Original'): void {
    this.snapshots = []
    this.nextId = 1
    const snap = this.blankSnapshot(name)
    this.snapshots.push(snap)
    this.activeId = snap.id
    // The store already holds the alignment; capture module defaults into it.
    this.captureActive()
    this.emit()
  }

  private blankSnapshot(name: string, parentId?: number): Snapshot {
    return { id: this.nextId++, name, parentId, sequences: [], slices: {} }
  }

  get active(): Snapshot | undefined {
    return this.snapshots.find((s) => s.id === this.activeId)
  }

  /** Stable-ish key for useSyncExternalStore: changes when the list/active does. */
  listKey(): string {
    return this.activeId + ':' + this.snapshots.map((s) => `${s.id}/${s.name}`).join(',')
  }

  list(): SnapshotInfo[] {
    return this.snapshots.map((s) => ({
      id: s.id,
      name: s.name,
      parentId: s.parentId,
      sequences: s.id === this.activeId ? this.ctrl.sequenceCount() : s.sequences.length,
      columns: s.id === this.activeId ? this.ctrl.columnCount() : (s.sequences[0]?.codes.length ?? 0),
      active: s.id === this.activeId,
    }))
  }

  // ---- capture / restore --------------------------------------------------

  /** Write the live alignment + module state into the active snapshot object. */
  captureActive(): void {
    const snap = this.active
    if (!snap) return
    snap.sequences = this.ctrl.captureSequences()
    for (const mod of this.modules) snap.slices[mod.sliceKey] = mod.serialize()
  }

  private restore(snap: Snapshot): void {
    // Load the alignment topology, then let each module rehydrate its slice.
    this.ctrl.loadSequences(snap.sequences)
    for (const mod of this.modules) mod.hydrate(snap.slices[mod.sliceKey])
  }

  // ---- commands -----------------------------------------------------------

  switchTo(id: number): void {
    if (id === this.activeId) return
    const target = this.snapshots.find((s) => s.id === id)
    if (!target) return
    this.captureActive()
    this.activeId = id
    this.restore(target)
    this.emit()
  }

  /** Fork the active snapshot into a new instance and switch to it. */
  newSnapshot(name?: string): void {
    this.captureActive()
    const parent = this.active
    const snap = this.blankSnapshot(name ?? this.uniqueName(parent?.name ?? 'Snapshot'), parent?.id)
    // Deep-copy the parent's captured alignment + slices so edits diverge.
    if (parent) {
      snap.sequences = parent.sequences.map((s) => ({ name: s.name, codes: s.codes.slice() }))
      snap.slices = structuredClone(parent.slices)
    }
    this.snapshots.push(snap)
    this.activeId = snap.id
    this.restore(snap)
    this.emit()
  }

  rename(id: number, name: string): void {
    const snap = this.snapshots.find((s) => s.id === id)
    if (snap) {
      snap.name = name
      this.emit()
    }
  }

  remove(id: number): void {
    if (this.snapshots.length <= 1) return // never remove the last snapshot
    const idx = this.snapshots.findIndex((s) => s.id === id)
    if (idx < 0) return
    const wasActive = id === this.activeId
    this.snapshots.splice(idx, 1)
    if (wasActive) {
      const next = this.snapshots[Math.max(0, idx - 1)]
      this.activeId = next.id
      this.restore(next)
    }
    this.emit()
  }

  /** Overwrite the active snapshot's stored state with the live state. */
  overwrite(): void {
    this.captureActive()
    this.emit()
  }

  private uniqueName(base: string): string {
    const stem = base.replace(/ \d+$/, '')
    let n = 2
    const names = new Set(this.snapshots.map((s) => s.name))
    let name = `${stem} ${n}`
    while (names.has(name)) name = `${stem} ${++n}`
    return name
  }
}
