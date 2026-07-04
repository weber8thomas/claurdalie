// Non-React hub for the structure feature: owns the set of displayed models,
// fold state, the fold cache, per-model column↔residue maps, color/representation
// settings, and bridges the alignment editor to the loaded StructureViewer.
// Mirrors the project's "controller owns logic, React owns chrome" rule.
//
// Multiple structures can be shown at once (fold several sequences, or load a
// known structure to compare) — each gets a distinct color. Folds are cached by
// sequence content, so gap-only edits never re-fetch; each fold model keeps its
// own column↔residue map (rebuilt on gap edits) so hover→3D and 3D-pick→cursor
// stay correct per sequence. Never touches the grid's render loop.

import type { EditorController } from '../editor/EditorController'
import { toFoldInput } from './sanitize'
import { FoldCache } from './cache'
import { ResidueColumnMap } from './mapping'
import { structureFromFile } from './fileSource'
import { EsmFoldSource } from './esmfold'
import { superpose, parseCaCoords, applyTransformToPdb, caDeviations } from './superpose'
import { applySubstitution } from '../analysis/variant/mutate'
import type { Structure, StructureSource, FoldErrorKind } from './types'
import { FoldError } from './types'
import type { ColorMode, Representation, ViewerModel } from './viewer'

/** Distinct model colors (matches the app's brand palette, extended). */
const MODEL_COLORS = ['#2bb3a3', '#f3a83c', '#5b7cf0', '#ef5d6c', '#8b5cf6', '#22c55e', '#eab308', '#ec4899']

type ModelKind = 'fold' | 'file' | 'compare'

interface StructureModel {
  id: string
  label: string
  structure: Structure
  color: string
  kind: ModelKind
  /** Whether the model is rendered in the 3D viewer (hidden ≠ removed). */
  visible: boolean
  /** Alignment row this model was folded from (fold kind only). */
  rowId?: number
  /** Column↔residue map for the source row (fold kind only). */
  map?: ResidueColumnMap
  /** Extra note, e.g. superposition RMSD. */
  note?: string
  /** Per-residue Cα deviation (Å) vs the superposition target (compare kind). */
  deviation?: (number | null)[]
}

export interface ModelInfo {
  id: string
  label: string
  color: string
  kind: ModelKind
  residues: number
  origin: string
  linked: boolean
  visible: boolean
  note?: string
}

export interface StructureState {
  models: ModelInfo[]
  modelsRev: number
  busy: boolean
  busyMessage: string | null
  error: string | null
  errorKind: FoldErrorKind | null
  colorMode: ColorMode
  representation: Representation
  sourceLabel: string
  /** An externally-requested residue highlight (e.g. a variant), preferred over hover. */
  focus: { modelId: string; index: number } | null
}

export class StructureController {
  private source: StructureSource = new EsmFoldSource()
  private cache = new FoldCache()
  private models = new Map<string, StructureModel>()
  private fileCounter = 0
  private folding = false

  private state: StructureState = {
    models: [],
    modelsRev: 0,
    busy: false,
    busyMessage: null,
    error: null,
    errorKind: null,
    colorMode: 'plddt',
    representation: 'cartoon',
    sourceLabel: this.source.label,
    focus: null,
  }

  private listeners = new Set<() => void>()
  private version = 0

  constructor(private readonly editor: EditorController) {
    const store = editor.store
    store.on('reset', () => this.clearAll()) // row ids are reassigned on load
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

  private modelInfos(): ModelInfo[] {
    return [...this.models.values()].map((m) => ({
      id: m.id,
      label: m.label,
      color: m.color,
      kind: m.kind,
      residues: m.structure.residueCount,
      origin: m.structure.origin,
      linked: m.rowId != null,
      visible: m.visible,
      note: m.note,
    }))
  }
  private emit(patch: Partial<StructureState> = {}, modelsChanged = false): void {
    this.state = {
      ...this.state,
      ...patch,
      models: this.modelInfos(),
      modelsRev: this.state.modelsRev + (modelsChanged ? 1 : 0),
    }
    this.version++
    for (const fn of this.listeners) fn()
  }

  /** Models for the viewer, in insertion order. Hidden models are excluded. */
  viewerModels(): ViewerModel[] {
    return [...this.models.values()].filter((m) => m.visible).map((m) => ({
      id: m.id,
      pdb: m.structure.pdb,
      plddt: m.structure.plddt,
      color: m.color,
      deviation: m.deviation,
    }))
  }

  private rowExists(id: number): boolean {
    return this.editor.store.orderSnapshot().includes(id)
  }
  private nextColor(): string {
    const used = new Set([...this.models.values()].map((m) => m.color))
    return MODEL_COLORS.find((c) => !used.has(c)) ?? MODEL_COLORS[this.models.size % MODEL_COLORS.length]
  }

  // ---- folding -----------------------------------------------------------

  /**
   * Fold one or more alignment rows and add/update a model for each. Folds the
   * SELECTED rows (passed in) — this is what fixes "always folds the first row":
   * selecting a sequence name doesn't move the cursor, so the caller passes the
   * selected row ids explicitly.
   */
  async foldRows(rowIds: number[]): Promise<void> {
    if (this.folding || rowIds.length === 0) return
    this.folding = true
    this.emit({ busy: true, busyMessage: `Folding ${rowIds.length} sequence${rowIds.length > 1 ? 's' : ''}…`, error: null, errorKind: null })
    let failed: FoldError | null = null
    for (let i = 0; i < rowIds.length; i++) {
      if (!this.rowExists(rowIds[i])) continue
      this.emit({ busyMessage: `Folding ${i + 1}/${rowIds.length}: ${this.editor.store.getRow(rowIds[i]).name}…` })
      try {
        await this.foldOne(rowIds[i])
      } catch (e) {
        failed = e instanceof FoldError ? e : new FoldError('network', String(e))
      }
    }
    this.folding = false
    this.emit(
      failed
        ? { busy: false, busyMessage: null, error: failed.message, errorKind: failed.kind }
        : { busy: false, busyMessage: null, error: null, errorKind: null },
    )
  }

  private async foldOne(rowId: number): Promise<void> {
    const codes = this.editor.store.materializeRow(rowId)
    const input = toFoldInput(codes)
    if (input.sequence.length === 0) throw new FoldError('empty', 'That sequence has no residues to fold')

    const cached = this.cache.get(input.sequence)
    const structure = cached ?? (await this.source.fold(input.sequence))
    if (!cached) this.cache.set(input.sequence, structure)

    const id = `row:${rowId}`
    const existing = this.models.get(id)
    this.models.set(id, {
      id,
      label: this.editor.store.getRow(rowId).name,
      structure,
      color: existing?.color ?? this.nextColor(),
      kind: 'fold',
      rowId,
      visible: existing?.visible ?? true,
      map: ResidueColumnMap.build(codes),
      note: input.substitutions > 0 ? `${input.substitutions} substituted` : undefined,
    })
    this.emit({}, true)
  }

  /**
   * Fold the MUTANT of a variant and overlay it on the wild-type fold: apply the
   * substitution to the row's ungapped sequence, fold it (cached), superpose onto
   * the WT fold, and store the per-residue Cα deviation so the "Difference" color
   * mode lights up where the structures diverge. Highlights the mutated residue
   * and switches to deviation coloring so the effect is immediately visible.
   * On-demand (never automatic) and network-bound; degrades via typed FoldError.
   */
  async foldMutant(rowId: number, position: number, alt: string, label?: string): Promise<void> {
    if (this.folding || !this.rowExists(rowId)) return
    this.folding = true
    this.emit({ busy: true, busyMessage: `Folding mutant…`, error: null, errorKind: null })
    try {
      // The wild-type fold is the comparison target; fold it first if missing.
      const wtId = `row:${rowId}`
      if (!this.models.has(wtId)) await this.foldOne(rowId)
      const wt = this.models.get(wtId)
      if (!wt) throw new FoldError('invalid', 'Could not fold the wild-type sequence')

      const wtSeq = toFoldInput(this.editor.store.materializeRow(rowId)).sequence
      const mut = applySubstitution(wtSeq, position, alt)
      if (!mut) {
        throw new FoldError('invalid', `Can't fold this variant — position ${position} → "${alt}" is not a substitution`)
      }

      const cached = this.cache.get(mut.sequence)
      let structure = cached ?? (await this.source.fold(mut.sequence))
      if (!cached) this.cache.set(mut.sequence, structure)

      // Superpose onto WT and compute per-residue deviation + a summary.
      const mobileCa = parseCaCoords(structure.pdb)
      const refCa = parseCaCoords(wt.structure.pdb)
      const fit = superpose(mobileCa, refCa)
      let deviation: (number | null)[] | undefined
      let note: string
      const siteTag = `${mut.wild}${position}${alt.toUpperCase()}`
      if (fit) {
        deviation = caDeviations(mobileCa, refCa, fit.R, fit.t)
        structure = { ...structure, pdb: applyTransformToPdb(structure.pdb, fit.R, fit.t) }
        const dSite = deviation[position - 1]
        const wtP = wt.structure.plddt[position - 1]
        const mutP = structure.plddt[position - 1]
        const dP = typeof wtP === 'number' && typeof mutP === 'number' ? mutP - wtP : null
        note =
          `RMSD ${fit.rmsd.toFixed(2)} Å vs ${wt.label}` +
          (Number.isFinite(dSite) ? ` · ${(dSite as number).toFixed(1)} Å @ ${siteTag}` : '') +
          (dP != null ? ` · ΔpLDDT ${dP >= 0 ? '+' : ''}${dP.toFixed(0)}` : '')
      } else {
        note = 'too few Cα to superpose'
      }

      const id = `mut:${rowId}:${position}${alt.toUpperCase()}`
      const existing = this.models.get(id)
      this.models.set(id, {
        id,
        label: label ? `${label} (${siteTag})` : `${wt.label} ${siteTag}`,
        structure,
        color: existing?.color ?? this.nextColor(),
        kind: 'compare',
        visible: true,
        note,
        deviation,
      })
      this.folding = false
      // Show the difference immediately: deviation coloring + spotlight the site.
      this.emit(
        { busy: false, busyMessage: null, error: null, errorKind: null, colorMode: 'deviation', focus: { modelId: id, index: position - 1 } },
        true,
      )
    } catch (e) {
      this.folding = false
      const err = e instanceof FoldError ? e : new FoldError('network', String(e))
      this.emit({ busy: false, busyMessage: null, error: err.message, errorKind: err.kind })
    }
  }

  // ---- files & comparison -------------------------------------------------

  /** Load a local PDB as an independent model (offline). */
  loadFile(pdbText: string, fileName: string): void {
    try {
      const structure = structureFromFile(pdbText, fileName)
      const id = `file:${++this.fileCounter}`
      this.models.set(id, { id, label: fileName, structure, color: this.nextColor(), kind: 'file', visible: true })
      this.emit({ error: null, errorKind: null }, true)
    } catch (e) {
      const err = e instanceof FoldError ? e : new FoldError('invalid', String(e))
      this.emit({ error: err.message, errorKind: err.kind })
    }
  }

  /**
   * Load a known structure to compare against an existing model, superposing it
   * onto the target (best-fit over matched Cα by order) so they overlay.
   * `targetId` defaults to the first fold model.
   */
  compareFile(pdbText: string, fileName: string, targetId?: string): void {
    try {
      let structure = structureFromFile(pdbText, fileName)
      const target =
        (targetId && this.models.get(targetId)) ?? [...this.models.values()].find((m) => m.kind === 'fold') ?? null
      let note: string | undefined
      let deviation: (number | null)[] | undefined
      if (target) {
        const mobileCa = parseCaCoords(structure.pdb)
        const refCa = parseCaCoords(target.structure.pdb)
        const fit = superpose(mobileCa, refCa)
        if (fit) {
          deviation = caDeviations(mobileCa, refCa, fit.R, fit.t)
          structure = { ...structure, pdb: applyTransformToPdb(structure.pdb, fit.R, fit.t) }
          note = `RMSD ${fit.rmsd.toFixed(2)} Å / ${fit.n} Cα vs ${target.label}`
        } else {
          note = 'too few Cα to superpose'
        }
      }
      const id = `cmp:${++this.fileCounter}`
      this.models.set(id, { id, label: fileName, structure, color: this.nextColor(), kind: 'compare', visible: true, note, deviation })
      this.emit({ error: null, errorKind: null }, true)
    } catch (e) {
      const err = e instanceof FoldError ? e : new FoldError('invalid', String(e))
      this.emit({ error: err.message, errorKind: err.kind })
    }
  }

  removeModel(id: string): void {
    if (this.models.delete(id)) this.emit({}, true)
  }
  /** Show/hide a model in the 3D viewer without discarding it. */
  toggleModelVisibility(id: string): void {
    const m = this.models.get(id)
    if (!m) return
    m.visible = !m.visible
    this.emit({}, true) // bump modelsRev so the panel reconciles the viewer
  }
  clearAll(): void {
    this.models.clear()
    this.emit({ busy: false, busyMessage: null, error: null, errorKind: null }, true)
  }

  setColorMode(mode: ColorMode): void {
    this.emit({ colorMode: mode })
  }
  setRepresentation(rep: Representation): void {
    this.emit({ representation: rep })
  }

  // ---- linking -----------------------------------------------------------

  /** Which model/residue an alignment hover maps to, or null. */
  hoverTarget(visualRow: number, col: number): { modelId: string; index: number } | null {
    const rowId = this.editor.store.rowIdAt(visualRow)
    for (const m of this.models.values()) {
      if (!m.visible) continue
      if (m.rowId === rowId && m.map) {
        const index = m.map.residueAtColumn(col)
        return index == null ? null : { modelId: m.id, index }
      }
    }
    return null
  }

  /**
   * Externally request a residue highlight from an alignment (visualRow, col) —
   * used by the variant panel to spotlight a variant's residue in 3D. Pass an
   * out-of-range cell (e.g. -1, -1) to clear. Resolves the same way as hover.
   */
  focusColumn(visualRow: number, col: number): void {
    const t = visualRow < 0 || col < 0 ? null : this.hoverTarget(visualRow, col)
    const cur = this.state.focus
    if (cur?.modelId === t?.modelId && cur?.index === t?.index) return
    this.emit({ focus: t })
  }

  /** A 3D residue pick jumps the alignment cursor to the matching column. */
  pick(modelId: string, index: number | null): void {
    if (index == null) return
    const m = this.models.get(modelId)
    if (!m || m.rowId == null || !m.map) return
    const col = m.map.columnOfResidue(index)
    const vrow = this.editor.store.orderSnapshot().indexOf(m.rowId)
    if (col != null && vrow >= 0) this.editor.setCursor(vrow, col)
  }

  private onContentChanged(): void {
    let changed = false
    for (const m of [...this.models.values()]) {
      if (m.kind !== 'fold' || m.rowId == null) continue
      if (!this.rowExists(m.rowId)) {
        this.models.delete(m.id)
        changed = true
        continue
      }
      // Residues are invariant under gap edits — just rebuild the (cheap) map so
      // hover↔residue stays aligned with the moved gaps. No re-fold.
      m.map = ResidueColumnMap.build(this.editor.store.materializeRow(m.rowId))
    }
    if (changed) this.emit({}, true)
  }

  destroy(): void {
    this.listeners.clear()
  }
}
