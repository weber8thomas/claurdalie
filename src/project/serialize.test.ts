import { describe, it, expect } from 'vitest'
import {
  encodeCodes,
  decodeCodes,
  encodeProject,
  decodeProject,
  gzipJson,
  gunzipJson,
  gzipAvailable,
} from './serialize'
import type { Snapshot } from './types'

// ---- gap-RLE + base64 codec -------------------------------------------------

describe('gap-RLE codec', () => {
  const cases: number[][] = [
    [],
    [0, 0, 0], // all gap
    [1, 2, 3, 20, 26], // all residues, full code range
    [0, 1, 0, 0, 2, 0, 3], // mixed gaps + residues
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2], // interior gap run
    new Array(300).fill(0), // long gap run → multi-byte varint
    [...new Array(130).fill(0), 5, ...new Array(200).fill(0)], // varint boundary
  ]
  it('round-trips every pattern byte-identically', () => {
    for (const c of cases) {
      const codes = Uint8Array.from(c)
      const back = decodeCodes(encodeCodes(codes))
      expect(Array.from(back)).toEqual(c)
      expect(back).toBeInstanceOf(Uint8Array)
    }
  })
})

// ---- project encode / decode ------------------------------------------------

function seq(name: string, codes: number[]) {
  return { name, codes: Uint8Array.from(codes) }
}

function makeProject(): { snapshots: Snapshot[]; activeId: number; nextId: number } {
  const snapshots: Snapshot[] = [
    {
      id: 1,
      name: 'Original',
      sequences: [seq('alpha', [1, 2, 3]), seq('beta', [1, 0, 3])],
      slices: { conservation: { shown: ['shannon'] }, view: { schemeId: 'clustal', scrollX: 0, scrollY: 0 } },
    },
    {
      id: 2,
      name: 'Variant A',
      parentId: 1,
      // Same sequences (shared identity) but a WIDER, divergent layout.
      sequences: [seq('alpha', [1, 2, 3, 0]), seq('beta', [1, 0, 3, 3])],
      slices: {
        conservation: { shown: ['jsd', 'vectorNorm'] },
        tree: { newick: '(alpha,beta);', bootstrap: 0 },
      },
    },
  ]
  return { snapshots, activeId: 2, nextId: 3 }
}

describe('encodeProject / decodeProject', () => {
  it('round-trips a multi-snapshot project with shared seqinfo', () => {
    const { snapshots, activeId, nextId } = makeProject()
    const sp = encodeProject(snapshots, activeId, nextId)

    // seqinfo holds each sequence name ONCE (shared identity across snapshots).
    expect(sp.seqinfo).toEqual(['alpha', 'beta'])
    // Every row references seqinfo by index rather than repeating the name.
    for (const s of sp.snapshots) {
      expect(s.rows.map((r) => r.ref)).toEqual([0, 1])
    }

    const decoded = decodeProject(sp)
    expect(decoded.activeSnapshotId).toBe(2)
    expect(decoded.nextId).toBe(3)
    expect(decoded.snapshots).toHaveLength(2)

    // Per-snapshot layouts stay DISTINCT and typed arrays are byte-identical.
    const orig = decoded.snapshots.find((s) => s.name === 'Original')!
    const variant = decoded.snapshots.find((s) => s.name === 'Variant A')!
    expect(orig.sequences[0].codes).toBeInstanceOf(Uint8Array)
    expect(Array.from(orig.sequences[0].codes)).toEqual([1, 2, 3])
    expect(Array.from(orig.sequences[1].codes)).toEqual([1, 0, 3])
    expect(Array.from(variant.sequences[0].codes)).toEqual([1, 2, 3, 0])
    expect(Array.from(variant.sequences[1].codes)).toEqual([1, 0, 3, 3])
    expect(orig.sequences[0].codes.length).toBe(3)
    expect(variant.sequences[0].codes.length).toBe(4)

    // Module slices ride along per-snapshot and stay distinct.
    expect(orig.slices.conservation).toEqual({ shown: ['shannon'] })
    expect(variant.slices.conservation).toEqual({ shown: ['jsd', 'vectorNorm'] })
    expect(variant.slices.tree).toEqual({ newick: '(alpha,beta);', bootstrap: 0 })
    expect(variant.parentId).toBe(1)
  })

  it('rejects an unknown format version', () => {
    const { snapshots, activeId, nextId } = makeProject()
    const sp = encodeProject(snapshots, activeId, nextId)
    expect(() => decodeProject({ ...sp, version: 999 })).toThrow(/version/)
  })
})

// ---- gzip layer (platform-dependent) ---------------------------------------

describe('gzipJson / gunzipJson', () => {
  it('round-trips a serialized project through the gzip layer', async () => {
    const { snapshots, activeId, nextId } = makeProject()
    const sp = encodeProject(snapshots, activeId, nextId)
    const bytes = await gzipJson(sp)
    expect(bytes).toBeInstanceOf(Uint8Array)
    if (gzipAvailable()) {
      // gzip magic number when compression is actually available.
      expect(bytes[0]).toBe(0x1f)
      expect(bytes[1]).toBe(0x8b)
    }
    const back = await gunzipJson<typeof sp>(bytes)
    const decoded = decodeProject(back)
    expect(decoded.snapshots).toHaveLength(2)
    expect(Array.from(decoded.snapshots[1].sequences[0].codes)).toEqual([1, 2, 3, 0])
  })
})
