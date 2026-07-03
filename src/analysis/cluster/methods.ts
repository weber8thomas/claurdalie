// Clustering algorithms. All deterministic (no RNG — the worker forbids it):
// initializations use farthest-first traversal / fixed seeds so the same input
// always yields the same clusters. Each returns `assignments`: cluster index
// (0..k-1) per item, in input order.

export interface ClusterOutcome {
  assignments: number[]
  k: number
}

const MAX_K = 10

function kmax(n: number): number {
  return Math.max(1, Math.min(MAX_K, Math.floor(n / 2)))
}

// ---- k-means (vector) ----------------------------------------------------

function dist2(a: Float64Array, b: Float64Array): number {
  let s = 0
  for (let d = 0; d < a.length; d++) s += (a[d] - b[d]) ** 2
  return s
}

/** Deterministic farthest-first seeding: start at item 0, then greedily add the
 *  point maximizing the min distance to chosen seeds. */
function farthestFirst(vectors: Float64Array[], k: number): number[] {
  const seeds = [0]
  const minD = vectors.map((v) => dist2(v, vectors[0]))
  while (seeds.length < k) {
    let best = -1
    let bestD = -1
    for (let i = 0; i < vectors.length; i++) {
      if (minD[i] > bestD) {
        bestD = minD[i]
        best = i
      }
    }
    if (best < 0 || bestD === 0) break
    seeds.push(best)
    for (let i = 0; i < vectors.length; i++) minD[i] = Math.min(minD[i], dist2(vectors[i], vectors[best]))
  }
  return seeds
}

export function kmeans(vectors: Float64Array[], k: number, iters = 60): number[] {
  const n = vectors.length
  const dims = vectors[0]?.length ?? 0
  if (n === 0 || k <= 1) return new Array(n).fill(0)
  const seeds = farthestFirst(vectors, k)
  const kk = seeds.length
  let centroids = seeds.map((s) => Float64Array.from(vectors[s]))
  const assign = new Array(n).fill(0)
  for (let it = 0; it < iters; it++) {
    let moved = false
    for (let i = 0; i < n; i++) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < kk; c++) {
        const d = dist2(vectors[i], centroids[c])
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
    const sums = Array.from({ length: kk }, () => new Float64Array(dims))
    const cnt = new Array(kk).fill(0)
    for (let i = 0; i < n; i++) {
      cnt[assign[i]]++
      const s = sums[assign[i]]
      for (let d = 0; d < dims; d++) s[d] += vectors[i][d]
    }
    centroids = sums.map((s, c) => {
      if (cnt[c] === 0) return centroids[c]
      const out = new Float64Array(dims)
      for (let d = 0; d < dims; d++) out[d] = s[d] / cnt[c]
      return out
    })
    if (!moved && it > 0) break
  }
  return compact(assign)
}

/** Mean silhouette width for a vector clustering (−1..1); used to pick k. */
function silhouette(vectors: Float64Array[], assign: number[]): number {
  const n = vectors.length
  const k = Math.max(...assign) + 1
  if (k < 2) return -1
  const byCluster: number[][] = Array.from({ length: k }, () => [])
  assign.forEach((c, i) => byCluster[c].push(i))
  let total = 0
  for (let i = 0; i < n; i++) {
    const ci = assign[i]
    if (byCluster[ci].length <= 1) continue
    let a = 0
    for (const j of byCluster[ci]) if (j !== i) a += Math.sqrt(dist2(vectors[i], vectors[j]))
    a /= byCluster[ci].length - 1
    let b = Infinity
    for (let c = 0; c < k; c++) {
      if (c === ci || byCluster[c].length === 0) continue
      let d = 0
      for (const j of byCluster[c]) d += Math.sqrt(dist2(vectors[i], vectors[j]))
      b = Math.min(b, d / byCluster[c].length)
    }
    total += (b - a) / Math.max(a, b)
  }
  return total / n
}

export function autoKmeans(vectors: Float64Array[]): ClusterOutcome {
  const n = vectors.length
  const khi = kmax(n)
  if (khi < 2) return { assignments: new Array(n).fill(0), k: 1 }
  let best: number[] = new Array(n).fill(0)
  let bestScore = -Infinity
  let bestK = 1
  for (let k = 2; k <= khi; k++) {
    const a = kmeans(vectors, k)
    const s = silhouette(vectors, a)
    if (s > bestScore) {
      bestScore = s
      best = a
      bestK = Math.max(...a) + 1
    }
  }
  return { assignments: best, k: bestK }
}

// ---- Gaussian mixture + AIC/BIC (vector) ---------------------------------

interface MixtureFit {
  assignments: number[]
  logLik: number
  nParams: number
}

const TINY = 1e-6

function fitMixture(vectors: Float64Array[], k: number, iters = 80): MixtureFit {
  const n = vectors.length
  const dims = vectors[0]?.length ?? 1
  // Per-dimension variance floor at a fraction of the global variance. Without
  // it, near-duplicate points let extra components collapse to ~0 variance and
  // inflate the likelihood, so AIC/BIC over-split. Regularizing keeps model
  // selection honest.
  const varFloor = new Float64Array(dims)
  for (let d = 0; d < dims; d++) {
    let mean = 0
    for (let i = 0; i < n; i++) mean += vectors[i][d]
    mean /= n || 1
    let v = 0
    for (let i = 0; i < n; i++) v += (vectors[i][d] - mean) ** 2
    varFloor[d] = Math.max(TINY, 0.05 * (v / (n || 1)))
  }
  // Deterministic init from k-means.
  const init = k <= 1 ? new Array(n).fill(0) : kmeans(vectors, k)
  const kk = Math.max(...init) + 1
  const weights = new Array(kk).fill(1 / kk)
  const means = Array.from({ length: kk }, () => new Float64Array(dims))
  const vars = Array.from({ length: kk }, () => new Float64Array(dims).fill(1))
  const resp = Array.from({ length: n }, () => new Float64Array(kk))

  // init means/vars from the k-means assignment
  const cnt = new Array(kk).fill(0)
  init.forEach((c, i) => {
    cnt[c]++
    for (let d = 0; d < dims; d++) means[c][d] += vectors[i][d]
  })
  for (let c = 0; c < kk; c++) for (let d = 0; d < dims; d++) means[c][d] /= cnt[c] || 1

  let logLik = -Infinity
  for (let it = 0; it < iters; it++) {
    // E-step
    let ll = 0
    for (let i = 0; i < n; i++) {
      let norm = 0
      for (let c = 0; c < kk; c++) {
        let logp = Math.log(weights[c] + TINY)
        for (let d = 0; d < dims; d++) {
          const v = vars[c][d] + TINY
          const diff = vectors[i][d] - means[c][d]
          logp += -0.5 * (Math.log(2 * Math.PI * v) + (diff * diff) / v)
        }
        resp[i][c] = Math.exp(logp)
        norm += resp[i][c]
      }
      if (norm <= 0) {
        for (let c = 0; c < kk; c++) resp[i][c] = 1 / kk
        norm = 1
      } else {
        for (let c = 0; c < kk; c++) resp[i][c] /= norm
      }
      ll += Math.log(norm + TINY)
    }
    // M-step
    for (let c = 0; c < kk; c++) {
      let nc = 0
      for (let i = 0; i < n; i++) nc += resp[i][c]
      weights[c] = nc / n
      const mean = new Float64Array(dims)
      for (let i = 0; i < n; i++) for (let d = 0; d < dims; d++) mean[d] += resp[i][c] * vectors[i][d]
      for (let d = 0; d < dims; d++) mean[d] /= nc || 1
      means[c] = mean
      const varc = new Float64Array(dims)
      for (let i = 0; i < n; i++) {
        for (let d = 0; d < dims; d++) {
          const diff = vectors[i][d] - mean[d]
          varc[d] += resp[i][c] * diff * diff
        }
      }
      for (let d = 0; d < dims; d++) varc[d] = Math.max(varFloor[d], varc[d] / (nc || 1))
      vars[c] = varc
    }
    if (Math.abs(ll - logLik) < 1e-6) {
      logLik = ll
      break
    }
    logLik = ll
  }
  const assignments = resp.map((r) => {
    let best = 0
    for (let c = 1; c < kk; c++) if (r[c] > r[best]) best = c
    return best
  })
  const nParams = kk - 1 + kk * dims * 2 // weights + means + diagonal variances
  return { assignments: compact(assignments), logLik, nParams }
}

export function autoMixture(vectors: Float64Array[], criterion: 'aic' | 'bic'): ClusterOutcome {
  const n = vectors.length
  const khi = kmax(n)
  let best: number[] = new Array(n).fill(0)
  let bestScore = Infinity
  let bestK = 1
  for (let k = 1; k <= khi; k++) {
    const fit = fitMixture(vectors, k)
    const score = criterion === 'aic' ? 2 * fit.nParams - 2 * fit.logLik : fit.nParams * Math.log(n) - 2 * fit.logLik
    if (score < bestScore) {
      bestScore = score
      best = fit.assignments
      bestK = Math.max(...fit.assignments) + 1
    }
  }
  return { assignments: best, k: bestK }
}

// ---- Hierarchical / Secator (distance) -----------------------------------

/** Average-linkage agglomeration; auto-cut at the largest relative jump in
 *  merge height (an inertia-loss proxy, in the spirit of Secator). */
export function hierarchic(D: Float64Array[]): ClusterOutcome {
  const n = D.length
  if (n <= 2) return { assignments: new Array(n).fill(0), k: n === 0 ? 0 : 1 }
  // active clusters as lists of member indices
  const members: number[][] = Array.from({ length: n }, (_, i) => [i])
  const alive = new Set<number>(members.map((_, i) => i))
  // pairwise cluster distance cache (average linkage), start = D
  const cd = D.map((row) => Float64Array.from(row))
  const mergeHeights: number[] = []
  const mergeRecord: [number, number][] = []

  while (alive.size > 1) {
    // find closest active pair
    let bi = -1
    let bj = -1
    let bd = Infinity
    const ids = [...alive]
    for (let x = 0; x < ids.length; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        const d = cd[ids[x]][ids[y]]
        if (d < bd) {
          bd = d
          bi = ids[x]
          bj = ids[y]
        }
      }
    }
    mergeHeights.push(bd)
    mergeRecord.push([bi, bj])
    // merge bj into bi (average linkage update)
    const ni = members[bi].length
    const nj = members[bj].length
    for (const o of alive) {
      if (o === bi || o === bj) continue
      const nd = (cd[bi][o] * ni + cd[bj][o] * nj) / (ni + nj)
      cd[bi][o] = nd
      cd[o][bi] = nd
    }
    members[bi] = members[bi].concat(members[bj])
    alive.delete(bj)
  }

  // Choose the cut: the number of clusters just before the biggest jump in
  // successive merge heights. mergeHeights[t] is the height of the merge that
  // reduces cluster count from (n-t) to (n-t-1).
  let bestJump = -Infinity
  let cutAfter = mergeHeights.length // default: all merged (1 cluster)
  for (let t = 1; t < mergeHeights.length; t++) {
    const jump = mergeHeights[t] - mergeHeights[t - 1]
    if (jump > bestJump) {
      bestJump = jump
      cutAfter = t // stop before performing merge t → clusters = n - t
    }
  }
  const targetClusters = Math.max(1, n - cutAfter)
  const mergesToDo = n - targetClusters

  // Reconstruct the assignment by replaying the first `mergesToDo` merges via
  // union-find over the original indices. Cluster ids in mergeRecord are the
  // original indices they were created from, so union those directly.
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  for (let t = 0; t < mergesToDo; t++) {
    const [a, b] = mergeRecord[t]
    parent[find(a)] = find(b)
  }
  const assignments = new Array(n).fill(0)
  for (let i = 0; i < n; i++) assignments[i] = find(i)
  return { assignments: compact(assignments), k: targetClusters }
}

// ---- Density peaks (DPC, distance) ---------------------------------------

export function dpc(D: Float64Array[]): ClusterOutcome {
  const n = D.length
  if (n <= 2) return { assignments: new Array(n).fill(0), k: n === 0 ? 0 : 1 }
  // cutoff distance dc: ~2% percentile of pairwise distances
  const dists: number[] = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) dists.push(D[i][j])
  dists.sort((a, b) => a - b)
  const dc = dists[Math.floor(0.02 * dists.length)] || dists[0] || 1
  // local density rho (Gaussian kernel)
  const rho = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let j = 0; j < n; j++) if (j !== i) r += Math.exp(-((D[i][j] / dc) ** 2))
    rho[i] = r
  }
  // delta: min distance to a higher-density point (max distance for the peak)
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => rho[b] - rho[a])
  const delta = new Float64Array(n)
  const higherNbr = new Int32Array(n).fill(-1)
  let maxDist = 0
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (D[i][j] > maxDist) maxDist = D[i][j]
  for (let oi = 0; oi < n; oi++) {
    const i = order[oi]
    if (oi === 0) {
      delta[i] = maxDist
      continue
    }
    let best = Infinity
    let bestJ = -1
    for (let oj = 0; oj < oi; oj++) {
      const j = order[oj]
      if (D[i][j] < best) {
        best = D[i][j]
        bestJ = j
      }
    }
    delta[i] = best
    higherNbr[i] = bestJ
  }
  // centers: gamma = rho·delta. On the decision graph, cluster centers sit above
  // a clear gap. Sort by gamma descending and cut at the largest drop among the
  // top candidates (robust for small n, where a mean+kσ threshold is brittle).
  const gamma = Array.from({ length: n }, (_, i) => rho[i] * delta[i])
  const byGamma = Array.from({ length: n }, (_, i) => i).sort((a, b) => gamma[b] - gamma[a])
  const cap = kmax(n)
  let cut = 1
  let bestGap = -Infinity
  for (let i = 0; i < Math.min(cap, n - 1); i++) {
    const gap = gamma[byGamma[i]] - gamma[byGamma[i + 1]]
    if (gap > bestGap) {
      bestGap = gap
      cut = i + 1
    }
  }
  const centers = byGamma.slice(0, cut)
  if (centers.length === 0) centers.push(order[0])
  const label = new Int32Array(n).fill(-1)
  centers.forEach((c, idx) => (label[c] = idx))
  // assign the rest in descending density to their higher-density neighbor's label
  for (const i of order) {
    if (label[i] === -1) label[i] = higherNbr[i] >= 0 ? label[higherNbr[i]] : 0
  }
  return { assignments: compact(Array.from(label)), k: centers.length }
}

// ---- helpers -------------------------------------------------------------

/** Renumber cluster labels to a dense 0..k-1 range, preserving first-seen order. */
function compact(assign: number[]): number[] {
  const map = new Map<number, number>()
  return assign.map((c) => {
    let v = map.get(c)
    if (v === undefined) {
      v = map.size
      map.set(c, v)
    }
    return v
  })
}
