// One tree build: distance matrix (identity over selected columns) → NJ →
// optional bootstrap. Pure and worker-safe.

import { identityDistance, type GapHandling } from '../analysis/cluster/distance'
import { neighborJoin } from './nj'
import { bootstrapSupport } from './bootstrap'
import type { PhyloTree } from './types'

export interface TreeBuildOptions {
  names: string[]
  gap: GapHandling
  zones: [number, number][]
  bootstrap: number // replicate count (0 = none)
  seed?: number
}

export function buildTree(rows: Uint8Array[], width: number, opts: TreeBuildOptions): PhyloTree {
  const D = identityDistance(rows, width, opts.gap, opts.zones)
  const tree = neighborJoin(D, opts.names)
  if (opts.bootstrap > 0) bootstrapSupport(rows, width, opts.names, tree, opts.bootstrap, opts.seed ?? 1)
  return tree
}
