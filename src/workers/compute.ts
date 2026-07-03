// Pure numerics shared by the worker and its main-thread fallback.
//
// Kept free of Worker/DOM APIs so it can run anywhere and be unit-tested. The
// alignment arrives as a row-major flat Uint8Array (nRows × width) so it can be
// transferred to the worker with zero copies.

import { newCounts, countColumn } from '../analysis/conservation/columnCounts'
import { scoreColumn } from '../analysis/conservation/methods'
import { autoLabels } from '../analysis/conservation/automatic'
import type { ConservationMethodId, ScoreTrack } from '../analysis/conservation/types'
import { runClustering, type ClusterRunOptions, type ClusterRunResult } from '../analysis/cluster/run'
import { buildTree, type TreeBuildOptions } from '../tree/build'
import type { PhyloTree } from '../tree/types'

export interface ConservationRequest {
  flat: Uint8Array // row-major: flat[row * width + col]
  nRows: number
  width: number
  methods: ConservationMethodId[]
  /** Also compute the "automatic" conserved-column labels for each track. */
  labels?: boolean
  /** Optional per-group row subsets (visual row indices) for per-group tracks. */
  groups?: { id: number; rows: number[] }[]
}

export interface ConservationResult {
  tracks: Record<string, ScoreTrack>
  /** Non-gap residue count per column (drives label gating and per-group work). */
  totals: Uint16Array
}

export function computeConservation(req: ConservationRequest): ConservationResult {
  const { flat, nRows, width, methods } = req
  const groups = req.groups ?? []
  const totals = new Uint16Array(width)
  const scores: Record<string, Float32Array> = {}
  for (const m of methods) scores[m] = new Float32Array(width)
  // Per-group score buffers: groupScores[method][groupIdx][col].
  const groupScores: Record<string, Float32Array[]> = {}
  for (const m of methods) groupScores[m] = groups.map(() => new Float32Array(width))

  const counts = newCounts()
  for (let col = 0; col < width; col++) {
    counts.fill(0)
    const total = countColumn((r) => flat[r * width + col], nRows, counts)
    totals[col] = total
    const input = { counts, total }
    for (const m of methods) scores[m][col] = scoreColumn(m, input, nRows)
    // Per-group scores (count over just that group's rows).
    for (let g = 0; g < groups.length; g++) {
      const rows = groups[g].rows
      counts.fill(0)
      const gt = countColumn((r) => flat[rows[r] * width + col], rows.length, counts)
      const gInput = { counts, total: gt }
      for (const m of methods) groupScores[m][g][col] = scoreColumn(m, gInput, rows.length)
    }
  }

  const tracks: Record<string, ScoreTrack> = {}
  for (const m of methods) {
    const track: ScoreTrack = { method: m, scores: scores[m] }
    if (req.labels) track.labels = autoLabels(scores[m], totals)
    if (groups.length) track.groupScores = groups.map((grp, g) => ({ id: grp.id, scores: groupScores[m][g] }))
    tracks[m] = track
  }
  return { tracks, totals }
}

// ---- clustering ----------------------------------------------------------

export interface ClusterRequest {
  flat: Uint8Array
  nRows: number
  width: number
  options: ClusterRunOptions
}

/** Rebuild per-row views from the flat buffer and run the clustering. */
export function computeClustering(req: ClusterRequest): ClusterRunResult {
  const { flat, nRows, width } = req
  const rows: Uint8Array[] = []
  for (let r = 0; r < nRows; r++) rows.push(flat.subarray(r * width, (r + 1) * width))
  return runClustering(rows, width, req.options)
}

// ---- phylogenetic tree ---------------------------------------------------

export interface TreeRequest {
  flat: Uint8Array
  nRows: number
  width: number
  options: TreeBuildOptions
}

export function computeTree(req: TreeRequest): { tree: PhyloTree } {
  const { flat, nRows, width } = req
  const rows: Uint8Array[] = []
  for (let r = 0; r < nRows; r++) rows.push(flat.subarray(r * width, (r + 1) * width))
  return { tree: buildTree(rows, width, req.options) }
}

/** Transferable buffers in a conservation result (for postMessage). */
export function conservationTransferables(res: ConservationResult): Transferable[] {
  const t: Transferable[] = [res.totals.buffer]
  for (const track of Object.values(res.tracks)) {
    t.push(track.scores.buffer)
    if (track.labels) t.push(track.labels.buffer)
    if (track.groupScores) for (const g of track.groupScores) t.push(g.scores.buffer)
  }
  return t
}
