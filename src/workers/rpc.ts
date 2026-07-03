// Typed client for the numerics worker, with a main-thread fallback.
//
// If a Worker can't be constructed (SSR, tests, or a hostile CSP), the same
// pure compute runs inline so conservation still works — just on the UI thread.
// This keeps the feature offline-safe and testable.

import {
  computeConservation,
  conservationTransferables,
  computeClustering,
  computeTree,
  type ConservationRequest,
  type ConservationResult,
  type ClusterRequest,
  type TreeRequest,
} from './compute'
import type { ClusterRunResult } from '../analysis/cluster/run'
import type { PhyloTree } from '../tree/types'
import type { WorkerRequest, WorkerResponse } from './numerics.worker'

export class NumericsClient {
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()

  constructor() {
    try {
      if (typeof Worker !== 'undefined') {
        this.worker = new Worker(new URL('./numerics.worker.ts', import.meta.url), { type: 'module' })
        this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data)
        this.worker.onerror = () => this.failWorker()
      }
    } catch {
      this.worker = null // fall back to inline compute
    }
  }

  private onMessage(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.res)
    else p.reject(new Error(msg.error))
  }

  private failWorker(): void {
    // A worker-level error rejects everything in flight; future calls go inline.
    for (const [, p] of this.pending) p.reject(new Error('numerics worker failed'))
    this.pending.clear()
    this.worker = null
  }

  conservation(req: ConservationRequest, transfer: Transferable[] = [req.flat.buffer]): Promise<ConservationResult> {
    if (!this.worker) return Promise.resolve(computeConservation(req))
    const id = ++this.seq
    const message: WorkerRequest = { id, kind: 'conservation', req }
    return new Promise<ConservationResult>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      try {
        this.worker!.postMessage(message, transfer)
      } catch (e) {
        this.pending.delete(id)
        // Transfer/clone failure → run inline as a last resort.
        try {
          resolve(computeConservation(req))
        } catch {
          reject(e)
        }
      }
    })
  }

  cluster(req: ClusterRequest, transfer: Transferable[] = [req.flat.buffer]): Promise<ClusterRunResult> {
    if (!this.worker) return Promise.resolve(computeClustering(req))
    const id = ++this.seq
    const message: WorkerRequest = { id, kind: 'cluster', req }
    return new Promise<ClusterRunResult>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      try {
        this.worker!.postMessage(message, transfer)
      } catch (e) {
        this.pending.delete(id)
        try {
          resolve(computeClustering(req))
        } catch {
          reject(e)
        }
      }
    })
  }

  tree(req: TreeRequest, transfer: Transferable[] = [req.flat.buffer]): Promise<{ tree: PhyloTree }> {
    if (!this.worker) return Promise.resolve(computeTree(req))
    const id = ++this.seq
    const message: WorkerRequest = { id, kind: 'tree', req }
    return new Promise<{ tree: PhyloTree }>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      try {
        this.worker!.postMessage(message, transfer)
      } catch (e) {
        this.pending.delete(id)
        try {
          resolve(computeTree(req))
        } catch {
          reject(e)
        }
      }
    })
  }

  /** Re-export so callers can compute transferables symmetrically if needed. */
  static transferables = conservationTransferables

  destroy(): void {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
  }
}
