// Non-React hub for the structure feature: owns the reference row, fold state,
// the fold cache, and the column↔residue map, and bridges the alignment editor
// to whatever StructureViewer the panel has loaded. Mirrors the project's
// "controller owns logic, React owns chrome" rule (cf. EditorController).
//
// Performance discipline: this never touches the grid's render loop. Folding is
// async + abortable + cached; content edits rebuild only the (cheap) map unless
// the residues themselves changed (they don't, under gap-only editing), so gap
// edits cost zero network.

import type { EditorController } from '../editor/EditorController'
import { toFoldInput } from './sanitize'
import { FoldCache, hashSequence } from './cache'
import { ResidueColumnMap } from './mapping'
import { structureFromFile } from './fileSource'
import { EsmFoldSource } from './esmfold'
import type { Structure, StructureSource } from './types'
import { FoldError } from './types'

export type FoldPhase = 'idle' | 'loading' | 'ready' | 'error'

export interface StructureState {
  phase: FoldPhase
  /** Row id currently used as the structural reference, or null. */
  referenceRowId: number | null
  referenceName: string | null
  structure: Structure | null
  residues: number | null
  /** Substituted (non-standard) residue count in the folded sequence. */
  substitutions: number
  message: string | null
  errorKind: FoldError['kind'] | null
  sourceLabel: string
}

export class StructureController {
  private source: StructureSource = new EsmFoldSource()
  private cache = new FoldCache()
  private map: ResidueColumnMap | null = null
  private foldedSequence: string | null = null
  private inFlight: AbortController | null = null

  private state: StructureState = {
    phase: 'idle',
    referenceRowId: null,
    referenceName: null,
    structure: null,
    residues: null,
    substitutions: 0,
    message: null,
    errorKind: null,
    sourceLabel: this.source.label,
  }

  private listeners = new Set<() => void>()
  private version = 0

  constructor(private readonly editor: EditorController) {
    const store = editor.store
    store.on('reset', () => this.clearReference()) // row ids are reassigned on load
    const onEdit = () => this.onContentChanged()
    store.on('rowsChanged', onEdit)
    store.on('orderChanged', onEdit)
    store.on('layoutChanged', onEdit)
  }

  // ---- subscription (React) ----------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = (): number => this.version
  snapshot = (): StructureState => this.state
  private bump(patch: Partial<StructureState>): void {
    this.state = { ...this.state, ...patch }
    this.version++
    for (const fn of this.listeners) fn()
  }

  // ---- reference selection & folding -------------------------------------

  /** True if a row id is still present in the current alignment. */
  private rowExists(id: number): boolean {
    return this.editor.store.orderSnapshot().includes(id)
  }

  /** Pin a row as the structural reference and fold it (cache-first). */
  async setReference(rowId: number): Promise<void> {
    if (!this.rowExists(rowId)) return
    const name = this.editor.store.getRow(rowId).name
    this.map = null
    this.foldedSequence = null
    await this.foldRow(rowId, name)
  }

  private async foldRow(rowId: number, name: string): Promise<void> {
    const codes = this.editor.store.materializeRow(rowId)
    const input = toFoldInput(codes)

    // Cache-first: identical sequences never re-fetch.
    const cached = this.cache.get(input.sequence)
    if (cached) {
      this.map = ResidueColumnMap.build(codes)
      this.foldedSequence = input.sequence
      this.bump({
        phase: 'ready',
        referenceRowId: rowId,
        referenceName: name,
        structure: cached,
        residues: cached.residueCount,
        substitutions: input.substitutions,
        message: cached.origin,
        errorKind: null,
      })
      return
    }

    this.inFlight?.abort()
    const ac = new AbortController()
    this.inFlight = ac
    this.bump({
      phase: 'loading',
      referenceRowId: rowId,
      referenceName: name,
      structure: null,
      residues: input.sequence.length,
      substitutions: input.substitutions,
      message: `Folding ${input.sequence.length} residues…`,
      errorKind: null,
    })

    try {
      const structure = await this.source.fold(input.sequence, ac.signal)
      if (ac.signal.aborted) return
      this.cache.set(input.sequence, structure)
      this.map = ResidueColumnMap.build(codes)
      this.foldedSequence = input.sequence
      this.bump({
        phase: 'ready',
        structure,
        residues: structure.residueCount,
        message: structure.origin,
        errorKind: null,
      })
    } catch (e) {
      if (ac.signal.aborted) return
      const err = e instanceof FoldError ? e : new FoldError('network', String(e))
      this.bump({ phase: 'error', message: err.message, errorKind: err.kind })
    } finally {
      if (this.inFlight === ac) this.inFlight = null
    }
  }

  /** Re-fold the current reference (e.g. after a transient network error). */
  retry(): void {
    const id = this.state.referenceRowId
    if (id != null && this.rowExists(id)) void this.foldRow(id, this.editor.store.getRow(id).name)
  }

  /** Load an offline structure from an uploaded PDB file. */
  loadFromFile(pdbText: string, fileName: string): void {
    this.inFlight?.abort()
    try {
      const structure = structureFromFile(pdbText, fileName)
      // If a reference row is pinned, map against it; else linking is disabled.
      const id = this.state.referenceRowId
      this.map = id != null && this.rowExists(id) ? ResidueColumnMap.build(this.editor.store.materializeRow(id)) : null
      this.bump({
        phase: 'ready',
        structure,
        residues: structure.residueCount,
        message: structure.origin,
        errorKind: null,
      })
    } catch (e) {
      const err = e instanceof FoldError ? e : new FoldError('invalid', String(e))
      this.bump({ phase: 'error', message: err.message, errorKind: err.kind })
    }
  }

  clearReference(): void {
    this.inFlight?.abort()
    this.inFlight = null
    this.map = null
    this.foldedSequence = null
    this.bump({
      phase: 'idle',
      referenceRowId: null,
      referenceName: null,
      structure: null,
      residues: null,
      substitutions: 0,
      message: null,
      errorKind: null,
    })
  }

  /**
   * Content changed. Under gap-only editing the residues are invariant, so the
   * fold stays valid (cache hit) and we only rebuild the column↔residue map;
   * if residues somehow differ, we re-fold.
   */
  private onContentChanged(): void {
    const id = this.state.referenceRowId
    if (id == null) return
    if (!this.rowExists(id)) {
      this.clearReference()
      return
    }
    const codes = this.editor.store.materializeRow(id)
    const input = toFoldInput(codes)
    if (this.foldedSequence != null && hashSequence(input.sequence) === hashSequence(this.foldedSequence)) {
      // Same residues, gaps moved → rebuild the map only. No network, no bump
      // of the structure itself; the panel re-derives the highlight on hover.
      this.map = ResidueColumnMap.build(codes)
    } else {
      void this.foldRow(id, this.editor.store.getRow(id).name)
    }
  }

  // ---- linking -----------------------------------------------------------

  /** 0-based residue index for an alignment column (null on gap / no map). */
  residueForColumn(col: number): number | null {
    return this.map ? this.map.residueAtColumn(col) : null
  }
  /** Alignment column for a 0-based residue index (null if unmapped). */
  columnForResidue(residueIndex: number): number | null {
    return this.map ? this.map.columnOfResidue(residueIndex) : null
  }
  /** True if a visual row is the current structural reference. */
  isReferenceRow(visualIndex: number): boolean {
    const id = this.state.referenceRowId
    return id != null && this.editor.store.rowIdAt(visualIndex) === id
  }
  /** Current visual index of the reference row, or null if unset / removed. */
  referenceVisualIndex(): number | null {
    const id = this.state.referenceRowId
    if (id == null) return null
    const i = this.editor.store.orderSnapshot().indexOf(id)
    return i < 0 ? null : i
  }

  destroy(): void {
    this.inFlight?.abort()
    this.listeners.clear()
  }
}
