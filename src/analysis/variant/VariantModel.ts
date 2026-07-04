// Owns the set of variants a user is analysing: their per-sequence residue↔column
// maps, the selected scorer, and the computed impact scores. Pushes an
// impact-colored pin overlay onto the grid, exposes per-column markers + a
// results table for the panel, and drives the 3D residue highlight. Implements
// SerializableModule so the variant set rides the active snapshot.
//
// Addressing follows GroupModel/MotifModel: variants are stored by STABLE
// sequence NAME + 1-based ungapped position (row ids are reassigned on every
// snapshot reload). Columns are re-derived from a fresh ResidueColumnMap
// whenever the column composition changes (gaps moved), so pins stay aligned.

import type { EditorController } from '../../editor/EditorController'
import type { ConservationModel } from '../conservation/ConservationModel'
import type { StructureController } from '../../structure/StructureController'
import type { ColumnStatsCache } from '../../core/stats/ColumnStats'
import type { SerializableModule } from '../../project/types'
import { ResidueColumnMap } from '../../structure/mapping'
import { residueChar, GAP_CODE } from '../../core/alphabet'
import { VARIANT_SOURCES, variantSourceById } from './registry'
import {
  impactColor,
  impactBand,
  variantColumn,
  variantKey,
  VariantEffectError,
  type ImpactBand,
  type Variant,
  type VariantContext,
  type VariantEffectKind,
  type VariantEffectSource,
  type VariantScore,
} from './types'
import { parseVariants, type ParseError } from './io'

interface VariantSlice {
  variants: Variant[]
  sourceId: string
}

/** One row of the results table / one grid marker, fully resolved for the UI. */
export interface VariantResult {
  variant: Variant
  key: string
  /** Visual row of the variant's sequence, or -1 if the sequence is absent. */
  visualRow: number
  /** Alignment column, or null if the position doesn't map (past length / gap). */
  column: number | null
  score: number | null
  band: ImpactBand | null
  note: string | null
}

export class VariantModel implements SerializableModule<VariantSlice> {
  readonly sliceKey = 'variants'

  private variants: Variant[] = []
  private source: VariantEffectSource = VARIANT_SOURCES[0]
  private scores = new Map<string, VariantScore>()

  private busy = false
  private error: string | null = null
  private errorKind: VariantEffectKind | null = null
  private abort: AbortController | null = null

  // Rebuilt from the live alignment; keyed by sequence name.
  private maps = new Map<string, ResidueColumnMap>()
  private nameToVisual = new Map<string, number>()

  private listeners = new Set<() => void>()
  private unsub: () => void
  private lastColumnsVersion: number

  constructor(
    private ctrl: EditorController,
    private conservation: ConservationModel,
    private stats: ColumnStatsCache,
    private structure: StructureController | null = null,
  ) {
    this.lastColumnsVersion = ctrl.getColumnsVersion()
    this.rebuildMaps()
    this.unsub = ctrl.subscribe(() => {
      const v = ctrl.getColumnsVersion()
      if (v !== this.lastColumnsVersion) {
        this.lastColumnsVersion = v
        this.rebuildMaps()
        // Gaps moved → columns changed. Re-derive markers, and re-score locally
        // (offline sources only; never auto-refetch from a network endpoint).
        if (!this.source.needsNetwork && this.variants.length) void this.scoreAll()
        else {
          this.pushOverlay()
          this.emit()
        }
      }
    })
  }

  /** Late-bind the structure controller (created in a sibling App effect). */
  setStructure(sc: StructureController | null): void {
    this.structure = sc
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  // ---- queries ------------------------------------------------------------

  list(): Variant[] {
    return this.variants
  }
  sources(): VariantEffectSource[] {
    return VARIANT_SOURCES
  }
  sourceId(): string {
    return this.source.id
  }
  isBusy(): boolean {
    return this.busy
  }
  errorText(): string | null {
    return this.error
  }
  errorKindText(): VariantEffectKind | null {
    return this.errorKind
  }

  /** The variant's alignment column via the current per-sequence map, or null. */
  columnOf(v: Variant): number | null {
    const map = this.maps.get(v.seqName)
    return map ? variantColumn(v, map) : null
  }

  /** Fully-resolved rows for the results table (visual order by sequence). */
  results(): VariantResult[] {
    return this.variants.map((v) => {
      const key = variantKey(v)
      const column = this.columnOf(v)
      const scored = this.scores.get(key)
      const score = scored ? scored.score : null
      return {
        variant: v,
        key,
        visualRow: this.nameToVisual.get(v.seqName) ?? -1,
        column,
        score,
        band: score == null ? null : impactBand(score),
        note: scored?.note ?? null,
      }
    })
  }

  /** The variant at a specific cell (for the grid hover tooltip), or null. */
  variantAt(visualRow: number, col: number): { from: string; to: string; score: number | null; band: ImpactBand | null } | null {
    const name = this.ctrl.store.rowName(visualRow)
    if (!name) return null
    for (const v of this.variants) {
      if (v.seqName !== name) continue
      if (this.columnOf(v) !== col) continue
      const score = this.scores.get(variantKey(v))?.score ?? null
      const from = v.from ?? this.residueAt(v.seqName, v.position) ?? '·'
      return { from, to: v.to, score, band: score == null ? null : impactBand(score) }
    }
    return null
  }

  /** Impact-colored pins for a visual row (the provider handed to the renderer). */
  markersOf(visualRow: number): Array<{ col: number; color: string; score: number }> {
    const name = this.ctrl.store.rowName(visualRow)
    if (!name) return []
    const dark = this.ctrl.isDark()
    const out: Array<{ col: number; color: string; score: number }> = []
    for (const v of this.variants) {
      if (v.seqName !== name) continue
      const col = this.columnOf(v)
      if (col == null) continue
      const score = this.scores.get(variantKey(v))?.score ?? 0
      out.push({ col, color: impactColor(score, dark), score })
    }
    return out
  }

  // ---- commands -----------------------------------------------------------

  add(v: Variant): void {
    const key = variantKey(v)
    if (this.variants.some((x) => variantKey(x) === key)) return
    this.variants.push(v)
    if (!this.source.needsNetwork) void this.scoreAll()
    else {
      this.pushOverlay()
      this.emit()
    }
  }

  remove(key: string): void {
    this.variants = this.variants.filter((v) => variantKey(v) !== key)
    this.scores.delete(key)
    this.pushOverlay()
    this.emit()
  }

  clear(): void {
    this.variants = []
    this.scores.clear()
    this.pushOverlay()
    this.emit()
  }

  setSource(id: string): void {
    const s = variantSourceById(id)
    if (!s) return
    this.source = s
    this.error = null
    this.errorKind = null
    this.emit()
  }

  /** Import a CSV/TSV variants file; returns per-line parse errors for the UI. */
  importText(text: string): ParseError[] {
    const { variants, errors } = parseVariants(text)
    const seen = new Set(this.variants.map(variantKey))
    for (const v of variants) {
      const key = variantKey(v)
      if (!seen.has(key)) {
        seen.add(key)
        this.variants.push(v)
      }
    }
    if (!this.source.needsNetwork) void this.scoreAll()
    else {
      this.pushOverlay()
      this.emit()
    }
    return errors
  }

  cancel(): void {
    this.abort?.abort()
  }

  /**
   * Score every variant with the selected source. Variants are grouped by
   * sequence so each batch gets that sequence's residue↔column map in its
   * VariantContext (the scorer maps position→column through it). Offline sources
   * resolve immediately; a network source drives busy/error like AlignController.
   */
  async scoreAll(): Promise<void> {
    if (this.busy) return
    if (!this.variants.length) {
      this.scores.clear()
      this.pushOverlay()
      this.emit()
      return
    }

    // Group by sequence name (only sequences present in the alignment).
    const groups = new Map<string, Variant[]>()
    for (const v of this.variants) {
      if (!this.maps.has(v.seqName)) continue
      const g = groups.get(v.seqName)
      if (g) g.push(v)
      else groups.set(v.seqName, [v])
    }

    const controller = new AbortController()
    this.abort = controller
    const online = this.source.needsNetwork
    if (online) {
      this.busy = true
      this.error = null
      this.errorKind = null
      this.emit()
    }

    try {
      const next = new Map<string, VariantScore>()
      for (const [name, group] of groups) {
        const ctx = this.contextFor(name)
        const scored = await this.source.score(group, ctx, controller.signal)
        for (const s of scored) next.set(variantKey(s.variant), s)
      }
      this.scores = next
      this.busy = false
      this.error = null
      this.errorKind = null
      this.pushOverlay()
      this.emit()
    } catch (e) {
      if (controller.signal.aborted) {
        this.busy = false
        this.emit()
      } else {
        const err = e instanceof VariantEffectError ? e : new VariantEffectError('invalid', String(e))
        this.busy = false
        this.error = err.message
        this.errorKind = err.kind
        this.emit()
      }
    } finally {
      this.abort = null
    }
  }

  /** Assemble the VariantContext for one sequence (its map + shared app state). */
  private contextFor(seqName: string): VariantContext {
    const map = this.maps.get(seqName)
    return {
      columnScores: (method) => this.conservation.track(method),
      columnStats: (col) => this.stats.get(col),
      map,
      modelId: undefined,
    }
  }

  // ---- linking ------------------------------------------------------------

  /** Highlight a variant's residue in the 3D viewer (if its sequence is folded). */
  focus(v: Variant): void {
    if (!this.structure) return
    const visualRow = this.nameToVisual.get(v.seqName)
    const col = this.columnOf(v)
    if (visualRow == null || col == null) {
      this.structure.focusColumn(-1, -1)
      return
    }
    this.structure.focusColumn(visualRow, col)
    this.ctrl.scrollCellIntoView(visualRow, col)
  }

  clearFocus(): void {
    this.structure?.focusColumn(-1, -1)
  }

  /** True if this variant can be folded as a mutant (single canonical substitution). */
  canFold(v: Variant): boolean {
    return !!this.structure && /^[ACDEFGHIKLMNPQRSTVWY]$/i.test(v.to)
  }

  /**
   * Fold the mutant of a variant and overlay it on the wild-type structure in 3D
   * (superposed, colored by per-residue deviation, mutated residue highlighted).
   * On-demand only; the StructureController owns the busy/error/offline UX.
   */
  async foldMutant(v: Variant): Promise<void> {
    if (!this.structure) return
    const visualRow = this.nameToVisual.get(v.seqName)
    if (visualRow == null) return
    const rowId = this.ctrl.store.rowIdAt(visualRow)
    await this.structure.foldMutant(rowId, v.position, v.to, v.label)
  }

  /** The RMSD/ΔpLDDT note for a variant's folded mutant model, if it exists. */
  mutantNote(v: Variant): string | null {
    if (!this.structure) return null
    const visualRow = this.nameToVisual.get(v.seqName)
    if (visualRow == null) return null
    const rowId = this.ctrl.store.rowIdAt(visualRow)
    const id = `mut:${rowId}:${v.position}${v.to.toUpperCase()}`
    return this.structure.snapshot().models.find((m) => m.id === id)?.note ?? null
  }

  // ---- internals ----------------------------------------------------------

  /** Rebuild per-sequence maps + name→visual index from the live alignment. */
  private rebuildMaps(): void {
    this.maps.clear()
    this.nameToVisual.clear()
    const store = this.ctrl.store
    for (let v = 0; v < store.height; v++) {
      const id = store.rowIdAt(v)
      const name = store.getRow(id).name
      this.nameToVisual.set(name, v)
      this.maps.set(name, ResidueColumnMap.build(store.materializeRow(id)))
    }
  }

  private pushOverlay(): void {
    const active = this.variants.length > 0
    this.ctrl.setVariantMarkers(active ? { markersOf: (v) => this.markersOf(v), active: true } : null)
  }

  /** The residue currently at a variant's position (for auto-filling `from`). */
  residueAt(seqName: string, position: number): string | null {
    const map = this.maps.get(seqName)
    if (!map) return null
    const col = map.columnOfResidue(position - 1)
    if (col == null) return null
    const v = this.nameToVisual.get(seqName)
    if (v == null) return null
    const code = this.ctrl.store.residueAt(v, col)
    return code === GAP_CODE ? null : residueChar(code)
  }

  /** Ungapped length of a sequence (max valid variant position). */
  ungappedLength(seqName: string): number {
    return this.maps.get(seqName)?.residueCount ?? 0
  }

  /** Sequence names in visual order, for the add-form dropdown. */
  sequenceNames(): string[] {
    const store = this.ctrl.store
    const names: string[] = []
    for (let v = 0; v < store.height; v++) names.push(store.rowName(v))
    return names
  }

  // ---- SerializableModule -------------------------------------------------

  serialize(): VariantSlice {
    return { variants: this.variants.map((v) => ({ ...v })), sourceId: this.source.id }
  }

  hydrate(state: VariantSlice | undefined): void {
    this.variants = (state?.variants ?? []).map((v) => ({ ...v }))
    this.source = variantSourceById(state?.sourceId ?? '') ?? VARIANT_SOURCES[0]
    this.scores.clear()
    this.error = null
    this.errorKind = null
    this.lastColumnsVersion = this.ctrl.getColumnsVersion()
    this.rebuildMaps()
    // Re-derive scores against the freshly-loaded alignment (offline only).
    if (!this.source.needsNetwork && this.variants.length) void this.scoreAll()
    else {
      this.pushOverlay()
      this.emit()
    }
  }

  destroy(): void {
    this.unsub()
    this.abort?.abort()
    this.ctrl.setVariantMarkers(null)
    this.structure?.focusColumn(-1, -1)
    this.listeners.clear()
  }
}
