// The Snapshot spine — Claurdalie's answer to Ordalie's Snapshot Bar.
//
// A Snapshot is a parallel analytical hypothesis: one alignment topology plus
// every sub-module's state (conservation shown, clustering, tree, selection,
// view). Switching the active snapshot via the combobox must restore the EXACT
// state with no data loss. That only works if every sub-module can serialize
// itself into, and rehydrate itself from, the active snapshot — hence the
// SerializableModule contract below, which each analysis module implements.

/**
 * A sub-module that stores part of its state inside the active snapshot. The
 * ProjectStore calls `serialize()` when capturing a snapshot and `hydrate()`
 * after switching to one. `sliceKey` names this module's slot in Snapshot.slices.
 */
export interface SerializableModule<S = unknown> {
  readonly sliceKey: string
  serialize(): S
  hydrate(state: S | undefined): void
}

/** One captured aligned sequence (visual order preserved by array position). */
export interface SnapshotSequence {
  name: string
  /** Aligned residue codes including interior gaps (see core/alphabet). */
  codes: Uint8Array
}

export interface Snapshot {
  id: number
  name: string
  /** Snapshot this one was forked from, if any (provenance). */
  parentId?: number
  /** The alignment topology — sequences in visual (top-to-bottom) order. */
  sequences: SnapshotSequence[]
  /** Per-module serialized state, keyed by SerializableModule.sliceKey. */
  slices: Record<string, unknown>
}

export interface SnapshotInfo {
  id: number
  name: string
  parentId?: number
  sequences: number
  columns: number
  active: boolean
}

export interface Project {
  version: 1
  snapshots: Snapshot[]
  activeSnapshotId: number
}
