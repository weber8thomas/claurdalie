// Rigid-body superposition of one structure onto another (for "compare to an
// existing structure"). Uses Horn's quaternion method: build the 4×4 key matrix
// from the cross-covariance of the two Cα point sets, take its largest
// eigenvector (a rotation quaternion) via a symmetric Jacobi eigensolver, and
// derive rotation + translation. Pure and unit-tested so its correctness does
// not depend on the WebGL viewer.

type Vec3 = [number, number, number]
export type Mat3 = [number, number, number, number, number, number, number, number, number]

/** Parse Cα coordinates (Å) in file order. */
export function parseCaCoords(pdb: string): Vec3[] {
  const out: Vec3[] = []
  for (const line of pdb.split('\n')) {
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue
    if (line.slice(12, 16).trim() !== 'CA') continue
    const x = Number(line.slice(30, 38))
    const y = Number(line.slice(38, 46))
    const z = Number(line.slice(46, 54))
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) out.push([x, y, z])
  }
  return out
}

function centroid(pts: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0]
  for (const p of pts) {
    c[0] += p[0]
    c[1] += p[1]
    c[2] += p[2]
  }
  const n = pts.length || 1
  return [c[0] / n, c[1] / n, c[2] / n]
}

/** Jacobi eigen-decomposition of a symmetric n×n matrix (n small: 3 or 4). */
function jacobiEigen(A: number[][], n: number): { values: number[]; vectors: number[][] } {
  const a = A.map((r) => r.slice())
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 100; sweep++) {
    // Largest off-diagonal magnitude.
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j]
    if (off < 1e-20) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-18) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1)) || 1
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let i = 0; i < n; i++) {
          const aip = a[i][p]
          const aiq = a[i][q]
          a[i][p] = c * aip - s * aiq
          a[i][q] = s * aip + c * aiq
        }
        for (let i = 0; i < n; i++) {
          const api = a[p][i]
          const aqi = a[q][i]
          a[p][i] = c * api - s * aqi
          a[q][i] = s * api + c * aqi
        }
        for (let i = 0; i < n; i++) {
          const vip = v[i][p]
          const viq = v[i][q]
          v[i][p] = c * vip - s * viq
          v[i][q] = s * vip + c * viq
        }
      }
    }
  }
  return { values: a.map((_, i) => a[i][i]), vectors: v }
}

/**
 * Best-fit transform mapping `mobile` onto `ref` (minimizing RMSD over matched
 * points, matched by order up to the shorter length). Returns rotation R
 * (row-major 3×3), translation t, and the resulting RMSD.
 */
export function superpose(
  mobile: Vec3[],
  ref: Vec3[],
): { R: Mat3; t: Vec3; rmsd: number; n: number } | null {
  const n = Math.min(mobile.length, ref.length)
  if (n < 3) return null
  const m = mobile.slice(0, n)
  const r = ref.slice(0, n)
  const cm = centroid(m)
  const cr = centroid(r)

  // Cross-covariance S[i][j] = Σ (mobile-cm)_i (ref-cr)_j
  const S = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (let k = 0; k < n; k++) {
    const x = [m[k][0] - cm[0], m[k][1] - cm[1], m[k][2] - cm[2]]
    const y = [r[k][0] - cr[0], r[k][1] - cr[1], r[k][2] - cr[2]]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += x[i] * y[j]
  }
  const [Sxx, Sxy, Sxz] = S[0]
  const [Syx, Syy, Syz] = S[1]
  const [Szx, Szy, Szz] = S[2]

  // Horn's 4×4 key matrix.
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ]
  const { values, vectors } = jacobiEigen(N, 4)
  let best = 0
  for (let i = 1; i < 4; i++) if (values[i] > values[best]) best = i
  const q = [vectors[0][best], vectors[1][best], vectors[2][best], vectors[3][best]]
  const norm = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  const [w, x, y, z] = q.map((v) => v / norm)

  const R: Mat3 = [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ]
  const t: Vec3 = [
    cr[0] - (R[0] * cm[0] + R[1] * cm[1] + R[2] * cm[2]),
    cr[1] - (R[3] * cm[0] + R[4] * cm[1] + R[5] * cm[2]),
    cr[2] - (R[6] * cm[0] + R[7] * cm[1] + R[8] * cm[2]),
  ]

  let sq = 0
  for (let k = 0; k < n; k++) {
    const p = applyTransform(m[k], R, t)
    sq += (p[0] - r[k][0]) ** 2 + (p[1] - r[k][1]) ** 2 + (p[2] - r[k][2]) ** 2
  }
  return { R, t, rmsd: Math.sqrt(sq / n), n }
}

/**
 * Per-residue Cα deviation (Å) of `mobile` from `ref` AFTER applying the
 * superposition transform (R, t) to `mobile` — i.e. how far each matched residue
 * still sits from its counterpart once best-fit aligned. Length = mobile.length;
 * residues past the shorter structure (unmatched) are NaN. This is the signal a
 * "difference" coloring visualizes: near-zero where the two structures agree,
 * large where they diverge (e.g. around a destabilizing mutation).
 */
export function caDeviations(mobile: Vec3[], ref: Vec3[], R: Mat3, t: Vec3): number[] {
  const n = Math.min(mobile.length, ref.length)
  const out: number[] = new Array(mobile.length)
  for (let k = 0; k < mobile.length; k++) {
    if (k >= n) {
      out[k] = NaN
      continue
    }
    const p = applyTransform(mobile[k], R, t)
    const r = ref[k]
    out[k] = Math.hypot(p[0] - r[0], p[1] - r[1], p[2] - r[2])
  }
  return out
}

export function applyTransform(p: Vec3, R: Mat3, t: Vec3): Vec3 {
  return [
    R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + t[0],
    R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + t[1],
    R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + t[2],
  ]
}

/** Rewrite every ATOM/HETATM coordinate in a PDB by the given transform. */
export function applyTransformToPdb(pdb: string, R: Mat3, t: Vec3): string {
  const fmt = (v: number) => v.toFixed(3).padStart(8)
  return pdb
    .split('\n')
    .map((line) => {
      if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) return line
      const x = Number(line.slice(30, 38))
      const y = Number(line.slice(38, 46))
      const z = Number(line.slice(46, 54))
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return line
      const p = applyTransform([x, y, z], R, t)
      return line.slice(0, 30) + fmt(p[0]) + fmt(p[1]) + fmt(p[2]) + line.slice(54)
    })
    .join('\n')
}
