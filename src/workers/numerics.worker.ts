// Dedicated numerics worker. Runs off the main thread using ordinary
// postMessage + Transferables — no SharedArrayBuffer, so it works on GitHub
// Pages where COOP/COEP (and thus cross-origin isolation) are unavailable.

/// <reference lib="webworker" />
import { computeConservation, conservationTransferables, type ConservationRequest } from './compute'

export type WorkerRequest = { id: number; kind: 'conservation'; req: ConservationRequest }
export type WorkerResponse =
  | { id: number; ok: true; kind: 'conservation'; res: ReturnType<typeof computeConservation> }
  | { id: number; ok: false; error: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  try {
    if (msg.kind === 'conservation') {
      const res = computeConservation(msg.req)
      const response: WorkerResponse = { id: msg.id, ok: true, kind: 'conservation', res }
      ctx.postMessage(response, conservationTransferables(res))
    }
  } catch (err) {
    const response: WorkerResponse = { id: msg.id, ok: false, error: String(err) }
    ctx.postMessage(response)
  }
}
