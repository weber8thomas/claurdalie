// Ordalie's "automatic" conservation labeling: after scoring, cluster the raw
// column scores, rank clusters by mean, and label the two highest as
// 'globally' (1) and 'strictly' (2) conserved. Only columns with more than five
// residues participate (MIN_RESIDUES), matching the manual.

/**
 * 1-D k-means on the finite score values. Deterministic: initial centroids are
 * evenly spaced across the value range, so results are reproducible (no RNG in
 * the worker — see Workflow constraints).
 */
function kmeans1d(values: number[], k: number, iters = 40): number[] {
  if (values.length === 0) return []
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  if (lo === hi) return values.map(() => 0)
  const centroids = Array.from({ length: k }, (_, i) => lo + ((i + 0.5) * (hi - lo)) / k)
  const assign = new Array(values.length).fill(0)
  for (let it = 0; it < iters; it++) {
    let moved = false
    for (let i = 0; i < values.length; i++) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < k; c++) {
        const d = Math.abs(values[i] - centroids[c])
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (assign[i] !== best) {
        assign[i] = best
        moved = true
      }
    }
    const sum = new Array(k).fill(0)
    const cnt = new Array(k).fill(0)
    for (let i = 0; i < values.length; i++) {
      sum[assign[i]] += values[i]
      cnt[assign[i]]++
    }
    for (let c = 0; c < k; c++) if (cnt[c] > 0) centroids[c] = sum[c] / cnt[c]
    if (!moved && it > 0) break
  }
  return assign
}

/**
 * Produce per-column conservation labels (0 none, 1 globally, 2 strictly) from a
 * score track and a per-column residue total. Columns with total <= 5 or NaN
 * score are left 0.
 */
export function autoLabels(scores: Float32Array, totals: Uint16Array, minResidues = 6): Uint8Array {
  const labels = new Uint8Array(scores.length)
  const idx: number[] = []
  const vals: number[] = []
  for (let c = 0; c < scores.length; c++) {
    if (totals[c] >= minResidues && Number.isFinite(scores[c])) {
      idx.push(c)
      vals.push(scores[c])
    }
  }
  if (idx.length === 0) return labels
  const k = Math.min(3, new Set(vals).size)
  const assign = kmeans1d(vals, k)
  // Rank clusters by mean score, descending.
  const sum = new Array(k).fill(0)
  const cnt = new Array(k).fill(0)
  for (let i = 0; i < vals.length; i++) {
    sum[assign[i]] += vals[i]
    cnt[assign[i]]++
  }
  const order = Array.from({ length: k }, (_, c) => c).sort(
    (a, b) => (cnt[b] ? sum[b] / cnt[b] : -Infinity) - (cnt[a] ? sum[a] / cnt[a] : -Infinity),
  )
  const rank = new Map<number, number>()
  order.forEach((cluster, r) => rank.set(cluster, r)) // r=0 highest mean
  for (let i = 0; i < idx.length; i++) {
    const r = rank.get(assign[i])!
    if (r === 0) labels[idx[i]] = 2 // strictly conserved
    else if (r === 1) labels[idx[i]] = 1 // globally conserved
  }
  return labels
}
