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
  /** Radial: angle (radians) + radius = cumulative branch length. */
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
 * Layout node positions. Leaves are evenly spaced in [0,1] by their in-order
 * position; internal nodes sit at the mean of their children. `x`/`y` are the
 * dendrogram coords, `angle`/`radius` the radial coords — both filled so the
 * viewer can switch modes without recomputing.
 */
export function layoutTree(tree: PhyloTree): TreeLayout {
  const leaves = leafNodes(tree.root)
  const leafCount = Math.max(1, leaves.length)
  const depth = cumulativeDepths(tree.root)
  let maxDepth = 0
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d)
  const scale = maxDepth > 0 ? 1 / maxDepth : 1

  const leafPos = new Map<number, number>()
  leaves.forEach((l, i) => leafPos.set(l.id, leaves.length > 1 ? i / (leaves.length - 1) : 0.5))

  const nodes = new Map<number, LaidNode>()
  const place = (n: TreeNode, d: number): number => {
    const nodeDepth = depth.get(n.id)!
    let y: number
    if (n.children.length === 0) {
      y = leafPos.get(n.id)!
    } else {
      const ys = n.children.map((c) => place(c, d + 1))
      y = (Math.min(...ys) + Math.max(...ys)) / 2
    }
    const angle = y * 2 * Math.PI
    const radius = nodeDepth * scale
    nodes.set(n.id, { node: n, x: nodeDepth * scale, y, angle, radius, depth: d })
    return y
  }
  place(tree.root, 0)
  return { nodes, maxDepth, leafCount }
}

/** Radial (x,y) in [-1,1]² for a laid node. */
export function radialXY(n: LaidNode): { x: number; y: number } {
  return { x: n.radius * Math.cos(n.angle), y: n.radius * Math.sin(n.angle) }
}
