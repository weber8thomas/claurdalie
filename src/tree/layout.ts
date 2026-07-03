// Tree layout geometry — pure functions turning a PhyloTree into drawable node
// positions for a rectangular dendrogram or a radial layout. Coordinates are in
// a normalized space; the canvas viewer scales/pans them.

import type { PhyloTree, TreeNode } from './types'
import { leafNodes } from './types'

export interface LaidNode {
  node: TreeNode
  /** Dendrogram: x = cumulative branch length, y = leaf-order position. */
  x: number
  y: number
  /** Radial: angle (radians) + radius = topological level (tips at radius 1). */
  angle: number
  radius: number
  depth: number
}

export interface TreeLayout {
  nodes: Map<number, LaidNode>
  /** Max cumulative branch length (for scaling x / radius). */
  maxDepth: number
  leafCount: number
}

/** Cumulative branch length from the root to each node. */
function cumulativeDepths(root: TreeNode): Map<number, number> {
  const depth = new Map<number, number>()
  const walk = (n: TreeNode, acc: number) => {
    const d = acc + n.length
    depth.set(n.id, d)
    n.children.forEach((c) => walk(c, d))
  }
  walk(root, 0)
  return depth
}

/**
 * Angular wedge (radians) left open at the top of a radial layout so the first
 * and last leaves don't collide across the 0/2π seam.
 */
const RADIAL_GAP = Math.PI * 0.12

/**
 * Layout node positions. Leaves are evenly spaced in [0,1] by their in-order
 * position; internal nodes sit at the mean of their children.
 *
 * `x` is the dendrogram depth = cumulative branch length (a phylogram, so branch
 * lengths are honoured). `radius`/`angle` are the radial coords: to keep the
 * radial view legible when one branch dominates, radius is the topological
 * *level* (edges from the root) with tips aligned on the outer ring — a radial
 * cladogram — rather than branch length, which would collapse short branches
 * into the centre.
 */
export interface LayoutOptions {
  /**
   * When true the dendrogram `x` is the topological level (tips aligned at
   * x = 1) instead of cumulative branch length — a cladogram rather than a
   * phylogram. Radial coords are unaffected (always a cladogram).
   */
  cladogram?: boolean
}

export function layoutTree(tree: PhyloTree, opts: LayoutOptions = {}): TreeLayout {
  const leaves = leafNodes(tree.root)
  const leafCount = Math.max(1, leaves.length)
  const depth = cumulativeDepths(tree.root)
  let maxDepth = 0
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d)
  const scale = maxDepth > 0 ? 1 / maxDepth : 1

  // Deepest leaf level (edges from root), for normalizing the radial radius.
  let maxLevel = 0
  const levelWalk = (n: TreeNode, d: number) => {
    if (n.children.length === 0) maxLevel = Math.max(maxLevel, d)
    else n.children.forEach((c) => levelWalk(c, d + 1))
  }
  levelWalk(tree.root, 0)

  const leafPos = new Map<number, number>()
  leaves.forEach((l, i) => leafPos.set(l.id, leaves.length > 1 ? i / (leaves.length - 1) : 0.5))

  // Map a normalized y ∈ [0,1] to an angle, leaving RADIAL_GAP open at the top.
  const span = 2 * Math.PI - RADIAL_GAP
  const toAngle = (y: number) => RADIAL_GAP / 2 + y * span

  const nodes = new Map<number, LaidNode>()
  const place = (n: TreeNode, d: number): number => {
    const nodeDepth = depth.get(n.id)!
    let y: number
    if (n.children.length === 0) {
      y = leafPos.get(n.id)!
    } else {
      // Mean of direct children keeps subtrees evenly balanced (incl. multifurcations).
      const ys = n.children.map((c) => place(c, d + 1))
      y = ys.reduce((a, b) => a + b, 0) / ys.length
    }
    const angle = toAngle(y)
    // Radial: tips on the outer ring (radius 1), internal nodes by level.
    const radius = n.children.length === 0 ? 1 : maxLevel > 0 ? d / maxLevel : 0
    // Dendrogram x: branch length (phylogram) or level with tips at 1 (cladogram).
    const x = opts.cladogram ? (n.children.length === 0 ? 1 : maxLevel > 0 ? d / maxLevel : 0) : nodeDepth * scale
    nodes.set(n.id, { node: n, x, y, angle, radius, depth: d })
    return y
  }
  place(tree.root, 0)
  return { nodes, maxDepth, leafCount }
}

/** Radial (x,y) in [-1,1]² for a laid node. */
export function radialXY(n: LaidNode): { x: number; y: number } {
  return { x: n.radius * Math.cos(n.angle), y: n.radius * Math.sin(n.angle) }
}
