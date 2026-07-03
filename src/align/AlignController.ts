// Non-React hub for re-alignment: owns the chosen Aligner, the busy/error state,
// and the two re-align actions. Mirrors StructureController's "controller owns
// logic, React owns chrome" shape.
//
// "Re-align selection" rewrites the selected rows' gap layout in place (one undo
// entry). "Re-align into a new snapshot" forks the active snapshot FIRST — which
// deep-copies the parent's alignment + module state — so the original topology
// is preserved, then applies the new layout in the fork. Residues never change;
// only gaps move (see align/apply.ts).

import { GAP_CODE, residueChar } from '../core/alphabet'
import type { EditorController } from '../editor/EditorController'
import type { ProjectStore } from '../project/ProjectStore'
import { ALIGNERS, alignerById } from './registry'
import type { Aligner, AlignErrorKind } from './types'
import { AlignError } from './types'

export interface AlignerInfo {
  id: string
  label: string
  needsNetwork: boolean
}

export interface AlignState {
  alignerId: string
  aligners: AlignerInfo[]
  busy: boolean
  busyMessage: string | null
  error: string | null
  errorKind: AlignErrorKind | null
}

export class AlignController {
  private aligner: Aligner = ALIGNERS[0]
  private abort: AbortController | null = null

  private state: AlignState = {
    alignerId: this.aligner.id,
    aligners: ALIGNERS.map((a) => ({ id: a.id, label: a.label, needsNetwork: a.needsNetwork })),
    busy: false,
    busyMessage: null,
    error: null,
    errorKind: null,
  }

  private listeners = new Set<() => void>()
  private version = 0

  constructor(
    private readonly ctrl: EditorController,
    private readonly project: ProjectStore,
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = (): number => this.version
  snapshot = (): AlignState => this.state

  private emit(patch: Partial<AlignState> = {}): void {
    this.state = { ...this.state, ...patch }
    this.version++
    for (const fn of this.listeners) fn()
  }

  setAligner(id: string): void {
    const a = alignerById(id)
    if (!a) return
    this.aligner = a
    this.emit({ alignerId: a.id })
  }

  currentAligner(): Aligner {
    return this.aligner
  }

  cancel(): void {
    this.abort?.abort()
  }

  /**
   * Re-align the selected sequences. With `intoNewSnapshot`, the active snapshot
   * is forked first so the original is untouched.
   */
  async realign(intoNewSnapshot: boolean): Promise<void> {
    if (this.state.busy) return
    const rowIds = this.ctrl.selectedRowIdsInOrder()
    if (rowIds.length < 2) {
      this.emit({ error: 'Select at least two sequences to re-align.', errorKind: null })
      return
    }
    const store = this.ctrl.store
    const inputs = rowIds.map((id) => ({
      name: store.getRow(id).name,
      sequence: ungapped(store.materializeRow(id)),
    }))

    const controller = new AbortController()
    this.abort = controller
    this.emit({ busy: true, busyMessage: `Re-aligning ${inputs.length} sequences…`, error: null, errorKind: null })
    try {
      const aligned = await this.aligner.align(
        inputs,
        undefined,
        controller.signal,
        (m) => this.emit({ busyMessage: m }),
      )
      if (intoNewSnapshot) this.project.newSnapshot('Re-aligned')
      this.ctrl.applyAlignment(aligned)
      this.emit({ busy: false, busyMessage: null, error: null, errorKind: null })
    } catch (e) {
      if (controller.signal.aborted) {
        this.emit({ busy: false, busyMessage: null, error: null, errorKind: null })
      } else {
        const err = e instanceof AlignError ? e : new AlignError('network', String(e))
        this.emit({ busy: false, busyMessage: null, error: err.message, errorKind: err.kind })
      }
    } finally {
      this.abort = null
    }
  }

  destroy(): void {
    this.abort?.abort()
    this.listeners.clear()
  }
}

/** Full-width gapped codes → ungapped one-letter string. */
function ungapped(codes: Uint8Array): string {
  let s = ''
  for (const c of codes) if (c !== GAP_CODE) s += residueChar(c)
  return s
}
