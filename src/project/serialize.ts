// Project (de)serialization — the .clproj file format and its codecs.
//
// A project is a set of Snapshots (analytical instances) that all share the same
// SET of sequences (same names/identity) but each hold their own gap layout and
// per-module analysis state. So the on-disk shape stores the sequence names ONCE
// (`seqinfo`, shared) and, per snapshot, only each row's gapped layout (referring
// to `seqinfo` by index) plus the module slices (already JSON-safe).
//
// Gapped layouts are typed arrays (residue codes, gap = 0). MSAs are gap-heavy,
// so each row is stored as a gap-RLE byte stream, base64-encoded for JSON. The
// whole JSON document is then gzipped via the browser CompressionStream — no new
// dependency, and it round-trips through the Node test/CI environment too.

import type { Snapshot, SnapshotSequence } from './types'
import { GAP_CODE } from '../core/alphabet'
import { APP_VERSION } from '../version'

export const CLPROJ_VERSION = 1

/** One snapshot's row: an index into the shared `seqinfo` + its gapped codes. */
export interface SerializedRow {
  ref: number
  /** Base64 of the gap-RLE byte stream for the full-width gapped codes. */
  codes: string
}

export interface SerializedSnapshot {
  id: number
  name: string
  parentId?: number
  rows: SerializedRow[]
  slices: Record<string, unknown>
}

export interface SerializedProject {
  version: number
  /** APP_VERSION at save time (provenance / forward-compat hints). */
  app: string
  /** Shared sequence names — the identity of each sequence across snapshots. */
  seqinfo: string[]
  activeSnapshotId: number
  nextId: number
  snapshots: SerializedSnapshot[]
}

// ---- gap-RLE + base64 codec ------------------------------------------------

/** Emit a base-128 varint (LSB first, high bit = continuation) into `out`. */
function pushVarint(out: number[], value: number): void {
  let v = value >>> 0
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  out.push(v)
}

/**
 * Encode residue codes to a compact byte stream. Residue codes are 1..255; the
 * gap (code 0) is the RLE escape: a run of gaps becomes `0, varint(runLength)`,
 * while every non-gap residue passes through as its own byte.
 */
export function encodeCodes(codes: Uint8Array): string {
  const bytes: number[] = []
  let i = 0
  const n = codes.length
  while (i < n) {
    const c = codes[i]
    if (c === GAP_CODE) {
      let run = 0
      while (i < n && codes[i] === GAP_CODE) {
        run++
        i++
      }
      bytes.push(0)
      pushVarint(bytes, run)
    } else {
      bytes.push(c)
      i++
    }
  }
  return bytesToBase64(Uint8Array.from(bytes))
}

/** Inverse of `encodeCodes`. */
export function decodeCodes(b64: string): Uint8Array {
  const bytes = base64ToBytes(b64)
  const out: number[] = []
  let i = 0
  const n = bytes.length
  while (i < n) {
    const b = bytes[i++]
    if (b === GAP_CODE) {
      // Read varint run length.
      let run = 0
      let shift = 0
      for (;;) {
        const x = bytes[i++]
        run |= (x & 0x7f) << shift
        if ((x & 0x80) === 0) break
        shift += 7
      }
      for (let k = 0; k < run; k++) out.push(GAP_CODE)
    } else {
      out.push(b)
    }
  }
  return Uint8Array.from(out)
}

// Base64 without relying on Buffer (browser) or atob/btoa nuances — a tiny
// portable codec that works identically in the browser and in Node/vitest.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INV = (() => {
  const inv = new Int16Array(128).fill(-1)
  for (let i = 0; i < B64.length; i++) inv[B64.charCodeAt(i)] = i
  return inv
})()

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  const n = bytes.length
  for (; i + 2 < n; i += 3) {
    const b = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(b >> 18) & 63] + B64[(b >> 12) & 63] + B64[(b >> 6) & 63] + B64[b & 63]
  }
  const rem = n - i
  if (rem === 1) {
    const b = bytes[i] << 16
    out += B64[(b >> 18) & 63] + B64[(b >> 12) & 63] + '=='
  } else if (rem === 2) {
    const b = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64[(b >> 18) & 63] + B64[(b >> 12) & 63] + B64[(b >> 6) & 63] + '='
  }
  return out
}

export function base64ToBytes(b64: string): Uint8Array {
  let len = b64.length
  while (len > 0 && b64[len - 1] === '=') len--
  const outLen = (len * 3) >> 2
  const out = new Uint8Array(outLen)
  let o = 0
  let acc = 0
  let bits = 0
  for (let i = 0; i < len; i++) {
    const v = B64_INV[b64.charCodeAt(i)]
    if (v < 0) continue
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  return out
}

// ---- project <-> serialized ------------------------------------------------

/**
 * Build a SerializedProject from the in-memory snapshots. Assumes the active
 * snapshot's live state has already been captured into its object (ProjectStore
 * calls captureActive() before this).
 */
export function encodeProject(
  snapshots: Snapshot[],
  activeSnapshotId: number,
  nextId: number,
): SerializedProject {
  // Shared seqinfo: the union of names across snapshots, in first-seen order.
  const seqinfo: string[] = []
  const index = new Map<string, number>()
  const refOf = (name: string): number => {
    let r = index.get(name)
    if (r === undefined) {
      r = seqinfo.length
      seqinfo.push(name)
      index.set(name, r)
    }
    return r
  }
  const out: SerializedSnapshot[] = snapshots.map((s) => ({
    id: s.id,
    name: s.name,
    parentId: s.parentId,
    rows: s.sequences.map((seq) => ({ ref: refOf(seq.name), codes: encodeCodes(seq.codes) })),
    // Slices are produced by each module's serialize() and are JSON-safe by design.
    slices: structuredClone(s.slices),
  }))
  return {
    version: CLPROJ_VERSION,
    app: APP_VERSION,
    seqinfo,
    activeSnapshotId,
    nextId,
    snapshots: out,
  }
}

/** Rebuild the in-memory snapshot list from a SerializedProject. */
export function decodeProject(sp: SerializedProject): {
  snapshots: Snapshot[]
  activeSnapshotId: number
  nextId: number
} {
  if (sp.version !== CLPROJ_VERSION) {
    throw new Error(`Unsupported .clproj version ${sp.version} (expected ${CLPROJ_VERSION})`)
  }
  const snapshots: Snapshot[] = sp.snapshots.map((s) => ({
    id: s.id,
    name: s.name,
    parentId: s.parentId,
    sequences: s.rows.map<SnapshotSequence>((r) => ({
      name: sp.seqinfo[r.ref] ?? '?',
      codes: decodeCodes(r.codes),
    })),
    slices: structuredClone(s.slices),
  }))
  return { snapshots, activeSnapshotId: sp.activeSnapshotId, nextId: sp.nextId }
}

// ---- gzip layer (async, uses the platform CompressionStream) ---------------

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}
function utf8Decode(b: Uint8Array): string {
  return new TextDecoder().decode(b)
}

async function streamThrough(bytes: Uint8Array, ts: TransformStream): Promise<Uint8Array> {
  const writer = ts.writable.getWriter()
  void writer.write(bytes)
  void writer.close()
  const reader = ts.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

/** True when the platform provides gzip streams (browsers, Node ≥ 18). */
export function gzipAvailable(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

/** Serialize an object to gzipped UTF-8 JSON (falls back to plain JSON bytes). */
export async function gzipJson(obj: unknown): Promise<Uint8Array> {
  const json = utf8Encode(JSON.stringify(obj))
  if (!gzipAvailable()) return json
  return streamThrough(json, new CompressionStream('gzip'))
}

/** Inverse of gzipJson. Tolerates plain (ungzipped) JSON bytes as a fallback. */
export async function gunzipJson<T = unknown>(bytes: Uint8Array): Promise<T> {
  // gzip magic number is 0x1f 0x8b; if absent, assume plain JSON.
  const looksGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  const raw = looksGzip && gzipAvailable() ? await streamThrough(bytes, new DecompressionStream('gzip')) : bytes
  return JSON.parse(utf8Decode(raw)) as T
}
