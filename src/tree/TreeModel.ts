// Owns the current phylogenetic tree + its display options, builds it off-thread,
// and supports interactive re-root / swap. Implements SerializableModule so a
// tree (and how it's drawn) rides the active snapshot.

import type { EditorController } from '../editor/EditorController'
import { NumericsClient } from '../workers/rpc'
import type { SerializableModule } from '../project/types'
import type { GapHandling } from '../analysis/cluster/distance'
import { serializeNewick, parseTree } from './newick'
import type { PhyloTree, TreeNode } from './types'

export type TreeColorBy = 'none' | 'cluster' | 'phylum'
export type TreeMode = 'dendrogram' | 'radial'

export interface TreeBuildRequest {
  gap: GapHandling
  zones: [number, number][]
  bootstrap: number
}

interface TreeSlice {
  newick: string
  bootstrap: number
  mode: TreeMode
  colorBy: TreeColorBy
  showBootstrap: boolean
  branchLengths?: boolean
  showDistances?: boolean
  bootstrapThreshold?: number
}

export class TreeModel implements SerializableModule<TreeSlice | null> {
  readonly sliceKey = 'tree'
  private client = new NumericsClient()
  private tree: PhyloTree | null = null
  private listeners = new Set<() => void>()
  private computing = false
  private ver = 0
  private nextId = 1_000_000 // ids for nodes we synthesize on reroot

  mode: TreeMode = 'dendrogram'
  colorBy: TreeColorBy = 'cluster'
  showBootstrap = true
  bootstrapThreshold = 0.8
  /** Dendrogram scales edges by branch length (phylogram) when true. */
  branchLengths = true
  /** Draw the numeric branch length as a label along each edge. */
  showDistances = false

  constructor(private ctrl: EditorController) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    this.ver++
    for (const fn of this.listeners) fn()
  }

  current(): PhyloTree | null {
    return this.tree
  }
  isComputing(): boolean {
    return this.computing
  }
  /** Monotonic revision, bumped on every change (build, reroot, ladderize, …). */
  version(): number {
    return this.ver
  }

  async build(req: TreeBuildRequest): Promise<void> {
    this.computing = true
    this.emit()
    try {
      const { flat, nRows, width, names } = this.flatten()
      const res = await this.client.tree({ flat, nRows, width, options: { names, gap: req.gap, zones: req.zones, bootstrap: req.bootstrap } })
      this.tree = res.tree
    } catch {
      // leave the previous tree in place
    } finally {
      this.computing = false
      this.emit()
    }
  }

  setMode(mode: TreeMode): void {
    this.mode = mode
    this.emit()
  }
  setColorBy(c: TreeColorBy): void {
    this.colorBy = c
    this.emit()
  }
  setShowBootstrap(v: boolean): void {
    this.showBootstrap = v
    this.emit()
  }
  setBranchLengths(v: boolean): void {
    this.branchLengths = v
    this.emit()
  }
  setShowDistances(v: boolean): void {
    this.showDistances = v
    this.emit()
  }
  setBootstrapThreshold(v: number): void {
    this.bootstrapThreshold = Math.max(0, Math.min(1, v))
    this.emit()
  }

  /** Sort every node's children by subtree size for a tidy, laddered layout. */
  ladderize(dir: 'asc' | 'desc' = 'desc'): void {
    if (!this.tree) return
    const size = new Map<number, number>()
    const count = (n: TreeNode): number => {
      const c = n.children.length === 0 ? 1 : n.children.reduce((s, ch) => s + count(ch), 0)
      size.set(n.id, c)
      return c
    }
    count(this.tree.root)
    const sign = dir === 'desc' ? -1 : 1
    const sort = (n: TreeNode) => {
      n.children.sort((a, b) => sign * (size.get(a.id)! - size.get(b.id)!))
      n.children.forEach(sort)
    }
    sort(this.tree.root)
    this.emit()
  }

  /** Public lookup of a node by id (for hit-test driven UI). */
  nodeById(id: number): TreeNode | null {
    return this.find(id)
  }

  /** Swap the child order at a node (rotates its descendants in the drawing). */
  swapAt(nodeId: number): void {
    if (!this.tree) return
    const n = this.find(nodeId)
    if (n && n.children.length > 1) {
      n.children.reverse()
      this.emit()
    }
  }

  /** Re-root the tree at a node by reversing the edges on the root→node path. */
  rerootAt(nodeId: number): void {
    if (!this.tree || this.tree.root.id === nodeId) return
    const path = this.pathToRoot(nodeId)
    if (!path || path.length < 2) return
    for (let i = path.length - 1; i > 0; i--) {
      const child = path[i]
      const par = path[i - 1]
      par.children = par.children.filter((c) => c.id !== child.id)
      child.children.push(par)
      par.length = child.length
    }
    const target = path[path.length - 1]
    target.length = 0
    this.tree = { ...this.tree, root: target }
    this.emit()
  }

  private pathToRoot(nodeId: number): TreeNode[] | null {
    const path: TreeNode[] = []
    const dfs = (n: TreeNode): boolean => {
      path.push(n)
      if (n.id === nodeId) return true
      for (const c of n.children) if (dfs(c)) return true
      path.pop()
      return false
    }
    return this.tree && dfs(this.tree.root) ? path : null
  }

  private find(id: number): TreeNode | null {
    if (!this.tree) return null
    let found: TreeNode | null = null
    const walk = (n: TreeNode) => {
      if (n.id === id) found = n
      else n.children.forEach(walk)
    }
    walk(this.tree.root)
    return found
  }

  private flatten(): { flat: Uint8Array; nRows: number; width: number; names: string[] } {
    const store = this.ctrl.store
    const nRows = store.height
    const width = store.width
    const flat = new Uint8Array(nRows * width)
    const names: string[] = []
    for (let r = 0; r < nRows; r++) {
      names.push(store.rowName(r))
      const base = r * width
      for (let c = 0; c < width; c++) flat[base + c] = store.residueAt(r, c)
    }
    return { flat, nRows, width, names }
  }

  // ---- SerializableModule -------------------------------------------------

  serialize(): TreeSlice | null {
    if (!this.tree) return null
    return {
      newick: serializeNewick(this.tree),
      bootstrap: this.tree.bootstrap,
      mode: this.mode,
      colorBy: this.colorBy,
      showBootstrap: this.showBootstrap,
      branchLengths: this.branchLengths,
      showDistances: this.showDistances,
      bootstrapThreshold: this.bootstrapThreshold,
    }
  }
  hydrate(state: TreeSlice | null | undefined): void {
    if (!state) {
      this.tree = null
    } else {
      this.tree = parseTree(state.newick)
      this.tree.bootstrap = state.bootstrap
      this.mode = state.mode
      this.colorBy = state.colorBy
      this.showBootstrap = state.showBootstrap
      this.branchLengths = state.branchLengths ?? true
      this.showDistances = state.showDistances ?? false
      this.bootstrapThreshold = state.bootstrapThreshold ?? 0.8
    }
    void this.nextId
    this.emit()
  }

  destroy(): void {
    this.client.destroy()
  }
}
