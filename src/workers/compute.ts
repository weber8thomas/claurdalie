// Pure numerics shared by the worker and its main-thread fallback.
//
// Kept free of Worker/DOM APIs so it can run anywhere and be unit-tested. The
// alignment arrives as a row-major flat Uint8Array (nRows × width) so it can be
// transferred to the worker with zero copies.

import { newCounts, countColumn } from '../analysis/conservation/columnCounts'
import { scoreColumn } from '../analysis/conservation/methods'
import { autoLabels } from '../analysis/conservation/automatic'
import type { ConservationMethodId, ScoreTrack } from '../analysis/conservation/types'

export interface ConservationRequest {
  flat: Uint8Array // row-major: flat[row * width + col]
  nRows: number
  width: number
  methods: ConservationMethodId[]
  /** Also compute the "automatic" conserved-column labels for each track. */
  labels?: boolean
}

export interface ConservationResult {
  tracks: Record<string, ScoreTrack>
  /** Non-gap residue count per column (drives label gating and per-group work). */
  totals: Uint16Array
}

export function computeConservation(req: ConservationRequest): ConservationResult {
  const { flat, nRows, width, methods } = req
  const totals = new Uint16Array(width)
  const scores: Record<string, Float32Array> = {}
  for (const m of methods) scores[m] = new Float32Array(width)

  const counts = newCounts()
  for (let col = 0; col < width; col++) {
    counts.fill(0)
    const total = countColumn((r) => flat[r * width + col], nRows, counts)
    totals[col] = total
    const input = { counts, total }
    for (const m of methods) scores[m][col] = scoreColumn(m, input, nRows)
  }

  const tracks: Record<string, ScoreTrack> = {}
  for (const m of methods) {
    const track: ScoreTrack = { method: m, scores: scores[m] }
    if (req.labels) track.labels = autoLabels(scores[m], totals)
    tracks[m] = track
  }
  return { tracks, totals }
}

/** Transferable buffers in a conservation result (for postMessage). */
export function conservationTransferables(res: ConservationResult): Transferable[] {
  const t: Transferable[] = [res.totals.buffer]
  for (const track of Object.values(res.tracks)) {
    t.push(track.scores.buffer)
    if (track.labels) t.push(track.labels.buffer)
  }
  return t
}
