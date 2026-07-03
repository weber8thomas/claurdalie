// Orchestrates conservation: flattens the live alignment, runs the numerics
// worker, caches one ScoreTrack per computed method, and tracks which methods
// are "shown" in the scores panel. Implements SerializableModule so the set of
// shown methods rides along with the active snapshot (and is recomputed on
// hydrate, since switching instances reloads the alignment).

import type { EditorController } from '../../editor/EditorController'
import { NumericsClient } from '../../workers/rpc'
import type { SerializableModule } from '../../project/types'
import type { ConservationMethodId, ScoreTrack } from './types'

interface ConservationSlice {
  shown: ConservationMethodId[]
}

export class ConservationModel implements SerializableModule<ConservationSlice> {
  readonly sliceKey = 'conservation'
  private client = new NumericsClient()
  private tracks = new Map<ConservationMethodId, ScoreTrack>()
  private shown = new Set<ConservationMethodId>()
  private listeners = new Set<() => void>()
  private unsub: () => void
  private lastContentVersion: number
  private recomputeTimer = 0
  private computing = new Set<ConservationMethodId>()

  constructor(private ctrl: EditorController) {
    this.lastContentVersion = ctrl.getContentVersion()
    // When the alignment data changes, shown tracks go stale → debounce recompute.
    this.unsub = ctrl.subscribe(() => {
      const v = ctrl.getContentVersion()
      if (v !== this.lastContentVersion) {
        this.lastContentVersion = v
        this.tracks.clear()
        this.scheduleRecompute()
      }
    })
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  // ---- queries ------------------------------------------------------------

  isShown(m: ConservationMethodId): boolean {
    return this.shown.has(m)
  }
  shownMethods(): ConservationMethodId[] {
    return [...this.shown]
  }
  track(m: ConservationMethodId): ScoreTrack | undefined {
    return this.tracks.get(m)
  }
  isComputing(m: ConservationMethodId): boolean {
    return this.computing.has(m)
  }

  // ---- commands -----------------------------------------------------------

  /** Toggle a method on/off in the scores panel, computing it if needed. */
  async toggle(m: ConservationMethodId): Promise<void> {
    if (this.shown.has(m)) {
      this.shown.delete(m)
      this.emit()
      return
    }
    this.shown.add(m)
    this.emit()
    await this.ensure(m)
  }

  private async ensure(m: ConservationMethodId): Promise<void> {
    if (this.tracks.has(m) || this.computing.has(m)) return
    this.computing.add(m)
    this.emit()
    try {
      const track = await this.compute(m)
      this.tracks.set(m, track)
    } catch {
      // Leave it uncomputed; the panel simply shows nothing for this method.
    } finally {
      this.computing.delete(m)
      this.emit()
    }
  }

  private async compute(m: ConservationMethodId): Promise<ScoreTrack> {
    const { flat, nRows, width } = this.flatten()
    const res = await this.client.conservation({ flat, nRows, width, methods: [m], labels: true })
    return res.tracks[m]
  }

  private scheduleRecompute(): void {
    if (typeof window === 'undefined') {
      this.recomputeNow()
      return
    }
    window.clearTimeout(this.recomputeTimer)
    this.recomputeTimer = window.setTimeout(() => this.recomputeNow(), 250)
  }
  private async recomputeNow(): Promise<void> {
    const methods = [...this.shown]
    await Promise.all(methods.map((m) => this.ensure(m)))
  }

  /** Row-major flatten of the live alignment for transfer to the worker. */
  private flatten(): { flat: Uint8Array; nRows: number; width: number } {
    const store = this.ctrl.store
    const nRows = store.height
    const width = store.width
    const flat = new Uint8Array(nRows * width)
    for (let r = 0; r < nRows; r++) {
      const base = r * width
      for (let c = 0; c < width; c++) flat[base + c] = store.residueAt(r, c)
    }
    return { flat, nRows, width }
  }

  // ---- SerializableModule -------------------------------------------------

  serialize(): ConservationSlice {
    return { shown: [...this.shown] }
  }
  hydrate(state: ConservationSlice | undefined): void {
    this.tracks.clear()
    this.shown = new Set(state?.shown ?? [])
    this.lastContentVersion = this.ctrl.getContentVersion()
    this.emit()
    // Recompute the restored methods against the freshly-loaded alignment.
    void this.recomputeNow()
  }

  destroy(): void {
    this.unsub()
    this.client.destroy()
    if (typeof window !== 'undefined') window.clearTimeout(this.recomputeTimer)
  }
}
