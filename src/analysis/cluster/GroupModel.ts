// Owns the active clustering/grouping and reflects it onto the alignment:
// reorders rows so each cluster is contiguous (one undo entry), drives the
// gutter group-color stripe, and exposes per-group row subsets for per-group
// conservation. Implements SerializableModule so grouping rides the snapshot.
//
// Membership is serialized by sequence NAME (stable across a snapshot reload,
// which reassigns row ids) and re-resolved to row ids on hydrate.

import type { EditorController } from '../../editor/EditorController'
import { NumericsClient } from '../../workers/rpc'
import type { SerializableModule } from '../../project/types'
import type { GapHandling } from './distance'
import type { ClusterCriterionId, ClusterMethodId, Cluster } from './types'
import { CATEGORICAL, NEUTRAL_GROUP } from '../../color/palette'

/** Distinct group colors (shared categorical palette); "Others" is neutral gray. */
const GROUP_COLORS = CATEGORICAL
const OTHERS_COLOR = NEUTRAL_GROUP

export interface GroupSubset {
  clusterId: number
  color: string
  name: string
  /** Visual row indices (current order) belonging to this group. */
  rows: number[]
}

interface SerializedCluster {
  name: string
  color: string
  memberNames: string[]
}
interface GroupSlice {
  method: ClusterMethodId
  criteria: ClusterCriterionId[]
  gap: GapHandling
  clusters: SerializedCluster[]
}

export interface ClusterRequestOptions {
  criteria: ClusterCriterionId[]
  method: ClusterMethodId
  gap: GapHandling
  zones: [number, number][]
  /** Visual row indices to cluster; the rest become "Others". */
  subset?: number[]
}

export class GroupModel implements SerializableModule<GroupSlice | null> {
  readonly sliceKey = 'groups'
  private client = new NumericsClient()
  private clusters: Cluster[] = []
  private rowToCluster = new Map<number, number>() // rowId → cluster.id
  private meta: { method: ClusterMethodId; criteria: ClusterCriterionId[]; gap: GapHandling } | null = null
  private listeners = new Set<() => void>()
  private computing = false

  constructor(private ctrl: EditorController) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  // ---- queries ------------------------------------------------------------

  hasGroups(): boolean {
    return this.clusters.length > 0
  }
  isComputing(): boolean {
    return this.computing
  }
  clusterInfos(): { id: number; name: string; color: string; size: number }[] {
    return this.clusters.map((c) => ({ id: c.id, name: c.name, color: c.color, size: c.members.length }))
  }
  /** Group color for a visual row (for the renderer hook). */
  colorOfVisualRow(v: number): string | null {
    const id = this.rowToCluster.get(this.ctrl.store.rowIdAt(v))
    if (id === undefined) return null
    return this.clusters.find((c) => c.id === id)?.color ?? null
  }
  /** Per-group visual-row subsets for per-group conservation. */
  groups(): GroupSubset[] {
    if (!this.clusters.length) return []
    const byCluster = new Map<number, number[]>()
    const h = this.ctrl.store.height
    for (let v = 0; v < h; v++) {
      const id = this.rowToCluster.get(this.ctrl.store.rowIdAt(v))
      if (id === undefined) continue
      if (!byCluster.has(id)) byCluster.set(id, [])
      byCluster.get(id)!.push(v)
    }
    return this.clusters.map((c) => ({ clusterId: c.id, color: c.color, name: c.name, rows: byCluster.get(c.id) ?? [] }))
  }

  // ---- commands -----------------------------------------------------------

  async cluster(opts: ClusterRequestOptions): Promise<void> {
    this.computing = true
    this.emit()
    try {
      const { flat, nRows, width } = this.flatten()
      const res = await this.client.cluster({ flat, nRows, width, options: { criteria: opts.criteria, method: opts.method, zones: opts.zones, gap: opts.gap, subset: opts.subset } })
      this.applyResult(res.assignments, res.k, res.hasOthers, opts)
    } catch {
      // leave existing grouping intact on failure
    } finally {
      this.computing = false
      this.emit()
    }
  }

  private applyResult(assignments: number[], k: number, hasOthers: boolean, opts: ClusterRequestOptions): void {
    const store = this.ctrl.store
    // assignments[v] is the cluster for visual row v (flat buffer is visual order).
    const clusters: Cluster[] = []
    const totalGroups = hasOthers ? k + 1 : k
    for (let id = 0; id < totalGroups; id++) {
      const isOthers = hasOthers && id === k
      clusters.push({
        id,
        name: isOthers ? 'Others' : `Group ${id + 1}`,
        color: isOthers ? OTHERS_COLOR : GROUP_COLORS[id % GROUP_COLORS.length],
        members: [],
      })
    }
    const rowToCluster = new Map<number, number>()
    for (let v = 0; v < assignments.length; v++) {
      const rowId = store.rowIdAt(v)
      const cid = assignments[v]
      rowToCluster.set(rowId, cid)
      clusters[cid]?.members.push(rowId)
    }
    this.clusters = clusters.filter((c) => c.members.length > 0)
    // Renumber ids densely after filtering empties.
    this.clusters.forEach((c, i) => {
      const old = c.id
      c.id = i
      for (const rid of c.members) rowToCluster.set(rid, i)
      void old
    })
    this.rowToCluster = rowToCluster
    this.meta = { method: opts.method, criteria: opts.criteria, gap: opts.gap }

    // Reorder rows so each cluster is contiguous (in cluster order).
    const newOrder: number[] = []
    for (const c of this.clusters) newOrder.push(...c.members)
    this.ctrl.reorderToOrder(newOrder)

    this.ctrl.setGroupColorHook((v) => this.colorOfVisualRow(v))
    this.emit()
  }

  renameCluster(id: number, name: string): void {
    const c = this.clusters.find((x) => x.id === id)
    if (c) {
      c.name = name
      this.emit()
    }
  }

  clear(): void {
    this.clusters = []
    this.rowToCluster.clear()
    this.meta = null
    this.ctrl.setGroupColorHook(null)
    this.emit()
  }

  private flatten(): { flat: Uint8Array; nRows: number; width: number } {
    const store = this.ctrl.store
    const nRows = store.height
    const width = store.width
    const flat = new Uint8Array(nRows * width)
    for (let r = 0; r < nRows; r++) {
      const base = r * width
      for (let c = 0; c < width; c++) flat[base + c] = store.residueAt(r, c)
    }
    return { flat, nRows, width }
  }

  // ---- SerializableModule -------------------------------------------------

  serialize(): GroupSlice | null {
    if (!this.meta || !this.clusters.length) return null
    const store = this.ctrl.store
    const nameOf = (rowId: number) => store.getRow(rowId).name
    return {
      method: this.meta.method,
      criteria: this.meta.criteria,
      gap: this.meta.gap,
      clusters: this.clusters.map((c) => ({ name: c.name, color: c.color, memberNames: c.members.map(nameOf) })),
    }
  }

  hydrate(state: GroupSlice | null | undefined): void {
    this.clusters = []
    this.rowToCluster.clear()
    this.meta = null
    if (!state) {
      this.ctrl.setGroupColorHook(null)
      this.emit()
      return
    }
    // Resolve member names → current row ids (order was restored by the snapshot).
    const store = this.ctrl.store
    const nameToRow = new Map<string, number>()
    for (let v = 0; v < store.height; v++) {
      const id = store.rowIdAt(v)
      const name = store.getRow(id).name
      if (!nameToRow.has(name)) nameToRow.set(name, id)
    }
    this.meta = { method: state.method, criteria: state.criteria, gap: state.gap }
    state.clusters.forEach((sc, id) => {
      const members = sc.memberNames.map((n) => nameToRow.get(n)).filter((x): x is number => x !== undefined)
      this.clusters.push({ id, name: sc.name, color: sc.color, members })
      for (const rid of members) this.rowToCluster.set(rid, id)
    })
    this.ctrl.setGroupColorHook((v) => this.colorOfVisualRow(v))
    this.emit()
  }

  destroy(): void {
    this.client.destroy()
  }
}
