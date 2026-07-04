import { useMemo, useState } from 'react'
import { Button, Group, Modal, Radio, Select, Text } from '@mantine/core'
import type { EditorController } from '../editor/EditorController'
import type { GroupModel } from '../analysis/cluster/GroupModel'
import { computeIdentity, pairIdentity, type IdentityReport } from '../analysis/identity/identity'
import type { GapHandling } from '../analysis/cluster/distance'

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
  const nameData = report?.names.map((n, i) => ({ value: String(i), label: n })) ?? []

  return (
    <Modal opened onClose={onClose} title="Sequence identity" size="lg" withCloseButton>
      <div className="identity-controls">
        <Radio.Group value={scope} onChange={(v) => setScope(v as Scope)} label="Scope">
          <Group gap="sm" mt={4}>
            <Radio size="xs" value="all" label="All" />
            <Radio size="xs" value="selected" label="Selected" />
          </Group>
        </Radio.Group>
        <Radio.Group value={gap} onChange={(v) => setGap(v as GapHandling)} label="Gaps">
          <Group gap="sm" mt={4}>
            <Radio size="xs" value="pairwise" label="Pairwise" />
            <Radio size="xs" value="global" label="Global" />
          </Group>
        </Radio.Group>
        <Button onClick={compute}>Compute</Button>
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
            <Text span className="cluster-label">
              Compare
            </Text>
            <Select size="xs" w={180} data={nameData} value={String(a)} onChange={(v) => v && setA(Number(v))} allowDeselect={false} />
            <span className="identity-vs">vs</span>
            <Select size="xs" w={180} data={nameData} value={String(b)} onChange={(v) => v && setB(Number(v))} allowDeselect={false} />
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
    </Modal>
  )
}
