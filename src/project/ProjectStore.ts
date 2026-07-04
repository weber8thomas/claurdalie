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
import {
  encodeProject,
  decodeProject,
  gzipJson,
  gunzipJson,
  type SerializedProject,
} from './serialize'

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
    // No restore(): a fresh fork is IDENTICAL to its parent, whose alignment +
    // every module's state is already live and valid. Reloading the alignment and
    // re-running each module's hydrate() (conservation recompute, variant rescore,
    // tree reparse, group rescan) would only recompute state the live editor
    // already shows — a pure main-thread stall on large alignments. The fork's
    // stored copy above is only read on a future switchTo()/export(), each of which
    // calls captureActive() first, so it never goes stale.
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

  // ---- persistence (the .clproj-equivalent) -------------------------------

  /** Serialize the whole project (captures live state first). */
  export(): SerializedProject {
    this.captureActive()
    return encodeProject(this.snapshots, this.activeId, this.nextId)
  }

  /** Replace the project with a serialized one and restore its active snapshot. */
  import(sp: SerializedProject): void {
    const { snapshots, activeSnapshotId, nextId } = decodeProject(sp)
    if (!snapshots.length) throw new Error('Project has no snapshots')
    this.snapshots = snapshots
    this.nextId = Math.max(nextId, ...snapshots.map((s) => s.id + 1))
    const active = snapshots.find((s) => s.id === activeSnapshotId) ?? snapshots[0]
    this.activeId = active.id
    this.restore(active)
    this.emit()
  }

  /** Gzipped .clproj bytes for download / IndexedDB. */
  async toFile(): Promise<Uint8Array> {
    return gzipJson(this.export())
  }

  /** Load a project from gzipped .clproj bytes. */
  async fromFile(bytes: Uint8Array): Promise<void> {
    const sp = await gunzipJson<SerializedProject>(bytes)
    this.import(sp)
  }

  // ---- single-instance (session) export/import ----------------------------
  //
  // The whole-project export above is one scope of a "session"; the other is a
  // single instance — its alignment + its metadata (module slices). Both share
  // the .clproj on-disk shape: a single-instance file is just a SerializedProject
  // carrying one snapshot. The scope difference lives in how the file is imported
  // (replace the project vs. add as a new instance), not in a separate format.

  /** Serialize ONLY the active instance (captures its live state first). */
  exportActive(): SerializedProject {
    this.captureActive()
    const snap = this.active
    if (!snap) throw new Error('No active instance to export')
    return encodeProject([snap], snap.id, this.nextId)
  }

  /** Gzipped .clproj bytes for just the active instance. */
  async toFileActive(): Promise<Uint8Array> {
    return gzipJson(this.exportActive())
  }

  /**
   * Merge a serialized project's snapshots into THIS project as new instances,
   * rather than replacing it. Incoming ids are remapped to fresh ones (so they
   * never collide), parent links are remapped within the incoming set (and
   * dropped otherwise), and names are de-duplicated. Switches to the first
   * added instance.
   *
   * A project normally holds instances of the SAME alignment, but each snapshot
   * carries its own sequences, so an instance imported from a different
   * alignment still restores correctly on switch (its groups/tree slices key off
   * that snapshot's own sequence names).
   */
  addInstances(sp: SerializedProject): void {
    const { snapshots } = decodeProject(sp)
    if (!snapshots.length) throw new Error('Nothing to import — file has no instances')
    this.captureActive()
    const idMap = new Map<number, number>()
    for (const s of snapshots) idMap.set(s.id, this.nextId++)
    let firstId: number | undefined
    for (const s of snapshots) {
      const newId = idMap.get(s.id)!
      const parentId = s.parentId !== undefined ? idMap.get(s.parentId) : undefined
      const taken = this.snapshots.some((x) => x.name === s.name)
      this.snapshots.push({ ...s, id: newId, parentId, name: taken ? this.uniqueName(s.name) : s.name })
      if (firstId === undefined) firstId = newId
    }
    if (firstId !== undefined) {
      this.activeId = firstId
      this.restore(this.snapshots.find((s) => s.id === firstId)!)
    }
    this.emit()
  }

  /** Add instances from gzipped .clproj bytes (see addInstances). */
  async addInstancesFromFile(bytes: Uint8Array): Promise<void> {
    const sp = await gunzipJson<SerializedProject>(bytes)
    this.addInstances(sp)
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
