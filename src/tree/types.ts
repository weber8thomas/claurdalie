// Phylogenetic tree data model.
//
// A tree is a set of nodes; leaves carry a sequence name, internal nodes carry
// children and an optional bootstrap support. Branch length is the distance to
// the parent. The tree is stored rooted (NJ output is midpoint-rooted); re-root
// / swap operations rewrite this structure.

export interface TreeNode {
  id: number
  /** Leaf label (sequence name) — undefined for internal nodes. */
  name?: string
  /** Branch length to the parent (root has 0). */
  length: number
  children: TreeNode[]
  /** Bootstrap support on the branch to the parent (0..1), if computed. */
  support?: number
}

export interface PhyloTree {
  root: TreeNode
  /** Ordered leaf names (as supplied to the builder). */
  leaves: string[]
  /** Number of bootstrap replicates behind `support`, or 0. */
  bootstrap: number
}

/** Depth-first list of leaf nodes (left-to-right). */
export function leafNodes(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (n: TreeNode) => {
    if (n.children.length === 0) out.push(n)
    else n.children.forEach(walk)
  }
  walk(root)
  return out
}

/** Total number of nodes in the tree. */
export function countNodes(root: TreeNode): number {
  let n = 1
  for (const c of root.children) n += countNodes(c)
  return n
}
