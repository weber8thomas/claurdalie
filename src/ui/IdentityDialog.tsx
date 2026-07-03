import { useEffect, useMemo, useState } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { GroupModel } from '../analysis/cluster/GroupModel'
import { computeIdentity, pairIdentity, type IdentityReport } from '../analysis/identity/identity'
import type { GapHandling } from '../analysis/cluster/distance'
import { Icon } from './Icon'

interface Props {
  ctrl: EditorController
  group?: GroupModel | null
  onClose: () => void
  onToast: (msg: string) => void
}

type Scope = 'all' | 'selected'

interface Gathered {
  rows: Uint8Array[]
  names: string[]
  groupOf: (number | null)[]
}

/** Collect rows for the chosen scope, plus each row's cluster id (or null). */
function gather(ctrl: EditorController, group: GroupModel | null | undefined, scope: Scope): Gathered {
  const store = ctrl.store
  // visual row → cluster id, from the active grouping.
  const clusterOf = new Map<number, number>()
  if (group?.hasGroups()) for (const g of group.groups()) for (const v of g.rows) clusterOf.set(v, g.clusterId)

  const visualRows: number[] =
    scope === 'selected'
      ? ctrl.selectedRowIdsInOrder().map((id) => store.orderSnapshot().indexOf(id)).filter((v) => v >= 0)
      : Array.from({ length: store.height }, (_, v) => v)

  const rows: Uint8Array[] = []
  const names: string[] = []
  const groupOf: (number | null)[] = []
  for (const v of visualRows) {
    rows.push(store.materializeRow(store.rowIdAt(v)))
    names.push(store.rowName(v))
    groupOf.push(clusterOf.has(v) ? clusterOf.get(v)! : null)
  }
  return { rows, names, groupOf }
}

export function IdentityDialog({ ctrl, group, onClose, onToast }: Props) {
  const [scope, setScope] = useState<Scope>('all')
  const [gap, setGap] = useState<GapHandling>('pairwise')
  const [report, setReport] = useState<IdentityReport | null>(null)
  const [rows, setRows] = useState<Uint8Array[]>([])
  const [a, setA] = useState(0)
  const [b, setB] = useState(1)

  const hasGroups = !!group?.hasGroups()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const compute = () => {
    const g = gather(ctrl, group, scope)
    if (g.rows.length < 2) {
      onToast(scope === 'selected' ? 'Select at least 2 sequences' : 'Need at least 2 sequences')
      return
    }
    const rep = computeIdentity({ rows: g.rows, width: ctrl.store.width, names: g.names, gap, groupOf: hasGroups ? g.groupOf : null })
    setReport(rep)
    setRows(g.rows)
    setA(0)
    setB(Math.min(1, g.names.length - 1))
    onToast(`Computed identity for ${g.rows.length} sequences`)
  }

  const pair = useMemo(() => {
    if (!report || a === b) return null
    return pairIdentity(report, rows, a, b)
  }, [report, rows, a, b])

  const nameAt = (i: number) => report?.names[i] ?? ''
  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '–')

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal identity-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" title="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
        <h2>Sequence identity</h2>

        <div className="identity-controls">
          <span className="cluster-label">Scope</span>
          <label className="cluster-check">
            <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> All
          </label>
          <label className="cluster-check">
            <input type="radio" checked={scope === 'selected'} onChange={() => setScope('selected')} /> Selected
          </label>
          <span className="cluster-label" style={{ marginLeft: 12 }}>
            Gaps
          </span>
          <label className="cluster-check">
            <input type="radio" checked={gap === 'pairwise'} onChange={() => setGap('pairwise')} /> Pairwise
          </label>
          <label className="cluster-check">
            <input type="radio" checked={gap === 'global'} onChange={() => setGap('global')} /> Global
          </label>
          <button className="btn primary" onClick={compute}>
            Compute
          </button>
        </div>

        {report && report.summary && (
          <>
            <div className="identity-summary">
              <div className="identity-stat">
                <span className="identity-stat-label">Mean</span>
                <span className="identity-stat-val">{fmt(report.summary.mean)}%</span>
              </div>
              <div className="identity-stat">
                <span className="identity-stat-label">Std dev</span>
                <span className="identity-stat-val">{fmt(report.summary.stddev)}</span>
              </div>
              <div className="identity-stat">
                <span className="identity-stat-label">Most similar</span>
                <span className="identity-stat-val">
                  {fmt(report.summary.max.pct)}% · {nameAt(report.summary.max.i)} / {nameAt(report.summary.max.j)}
                </span>
              </div>
              <div className="identity-stat">
                <span className="identity-stat-label">Most distant</span>
                <span className="identity-stat-val">
                  {fmt(report.summary.min.pct)}% · {nameAt(report.summary.min.i)} / {nameAt(report.summary.min.j)}
                </span>
              </div>
              <div className="identity-stat">
                <span className="identity-stat-label">Pairs</span>
                <span className="identity-stat-val">{report.summary.pairs}</span>
              </div>
            </div>

            <div className="identity-pair">
              <span className="cluster-label">Compare</span>
              <select className="select" value={a} onChange={(e) => setA(Number(e.target.value))}>
                {report.names.map((n, i) => (
                  <option key={i} value={i}>
                    {n}
                  </option>
                ))}
              </select>
              <span className="identity-vs">vs</span>
              <select className="select" value={b} onChange={(e) => setB(Number(e.target.value))}>
                {report.names.map((n, i) => (
                  <option key={i} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="identity-pair-result">
              {a === b ? (
                <span className="identity-muted">Pick two different sequences.</span>
              ) : pair ? (
                <>
                  <b>{fmt(pair.pct)}%</b> identity over <b>{pair.comparedLen}</b> compared columns · ungapped lengths{' '}
                  {report.ungappedLen[a]} / {report.ungappedLen[b]}
                </>
              ) : null}
            </div>

            {hasGroups && (
              <div className="identity-note">
                Grouping active — per-sequence within/outside-cluster nearest neighbours are computed (shown in a future
                per-sequence view).
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
