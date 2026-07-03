// Fold results are cached by sequence content, not by row.
//
// Claurdalie's core invariant is that edits only move gaps — residues never
// change. So folding the same sequence again (after gap edits, reorders, or
// re-selecting the reference row) must never hit the network twice. Keying by a
// hash of the *ungapped* sequence gives that for free, and it is stable across
// every gap-only edit. Cf. the column↔residue map, which is the opposite: it
// must be rebuilt on every gap edit (see mapping.ts).

import type { Structure } from './types'

/** FNV-1a, 32-bit — fast, dependency-free, good enough to key a small cache. */
export function hashSequence(seq: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < seq.length; i++) {
    h ^= seq.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + ':' + seq.length
}

/** Bounded most-recently-used cache of folded structures. */
export class FoldCache {
  private map = new Map<string, Structure>()
  constructor(private readonly max = 16) {}

  get(seq: string): Structure | undefined {
    const key = hashSequence(seq)
    const hit = this.map.get(key)
    if (hit) {
      // Refresh recency.
      this.map.delete(key)
      this.map.set(key, hit)
    }
    return hit
  }

  set(seq: string, value: Structure): void {
    const key = hashSequence(seq)
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  clear(): void {
    this.map.clear()
  }
}
