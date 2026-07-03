import { useState, useSyncExternalStore } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { GroupModel } from '../analysis/cluster/GroupModel'
import { CRITERIA, CLUSTER_METHODS, type ClusterCriterionId, type ClusterMethodId } from '../analysis/cluster/types'
import type { GapHandling } from '../analysis/cluster/distance'

interface Props {
  ctrl: EditorController
  group: GroupModel
  onClose: () => void
  onToast: (msg: string) => void
}

/** Visual row indices currently selected (for subset clustering → "Others"). */
function selectedVisualRows(ctrl: EditorController): number[] {
  const ids = ctrl.renderer.selectedRowIds
  if (!ids.size) return []
  const out: number[] = []
  for (let v = 0; v < ctrl.store.height; v++) if (ids.has(ctrl.store.rowIdAt(v))) out.push(v)
  return out
}

export function ClusterDialog({ ctrl, group, onClose, onToast }: Props) {
  const [criteria, setCriteria] = useState<Set<ClusterCriterionId>>(new Set(['identity']))
  const [method, setMethod] = useState<ClusterMethodId>('hierarchic')
  const [gap, setGap] = useState<GapHandling>('pairwise')
  useSyncExternalStore(
    (fn) => group.subscribe(fn),
    () => (group.isComputing() ? 'busy' : group.hasGroups() ? 'groups' : 'idle'),
  )

  const toggleCriterion = (id: ClusterCriterionId) => {
    setCriteria((prev) => {
      const next = new Set(prev)
      // Life-domain is categorical and cannot combine with numeric criteria.
      if (id === 'lifeDomain') return next.has(id) ? new Set() : new Set([id])
      next.delete('lifeDomain')
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size === 0) next.add('identity')
      return next
    })
  }

  const compute = async () => {
    const subset = selectedVisualRows(ctrl)
    if (subset.length > 0 && subset.length < 4) {
      onToast('Select at least 4 sequences (or none) to cluster')
      return
    }
    await group.cluster({
      criteria: [...criteria],
      method,
      gap,
      zones: [],
      subset: subset.length > 0 ? subset : undefined,
    })
    onToast(`Clustered into ${group.clusterInfos().length} group(s)`)
  }

  const infos = group.clusterInfos()

  return (
    <div className="cluster-dialog">
      <div className="cluster-head">
        <span className="scores-title">Clustering</span>
        <button className="scores-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      <div className="cluster-section">
        <div className="cluster-label">Criteria</div>
        <div className="cluster-criteria">
          {CRITERIA.map((c) => (
            <label key={c.id} className={'cluster-check' + (c.id === 'lifeDomain' ? ' disabled' : '')}>
              <input
                type="checkbox"
                checked={criteria.has(c.id)}
                disabled={c.id === 'lifeDomain'}
                onChange={() => toggleCriterion(c.id)}
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      <div className="cluster-section cluster-row">
        <label className="cluster-label" htmlFor="cl-method">
          Method
        </label>
        <select id="cl-method" className="select" value={method} onChange={(e) => setMethod(e.target.value as ClusterMethodId)}>
          {CLUSTER_METHODS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="cluster-section cluster-row">
        <span className="cluster-label">Gaps</span>
        <label className="cluster-check">
          <input type="radio" checked={gap === 'pairwise'} onChange={() => setGap('pairwise')} /> Pairwise
        </label>
        <label className="cluster-check">
          <input type="radio" checked={gap === 'global'} onChange={() => setGap('global')} /> Global
        </label>
      </div>

      <div className="cluster-actions">
        <button className="btn" onClick={() => void compute()} disabled={group.isComputing()}>
          {group.isComputing() ? 'Computing…' : 'Compute'}
        </button>
        <button className="snapshot-btn" onClick={() => group.clear()} disabled={!group.hasGroups()}>
          No clusters
        </button>
      </div>

      {infos.length > 0 && (
        <div className="cluster-legend">
          {infos.map((c) => (
            <div key={c.id} className="cluster-item">
              <span className="cluster-swatch" style={{ background: c.color }} />
              <input
                className="cluster-name"
                defaultValue={c.name}
                onBlur={(e) => group.renameCluster(c.id, e.target.value.trim() || c.name)}
              />
              <span className="cluster-size">{c.size}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
