import { useState, useSyncExternalStore } from 'react'
import { ActionIcon, Button, Checkbox, Group, Radio, Select, Text, TextInput } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
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
      <div className="panel-head">
        <span className="panel-title">Clustering</span>
        <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label="Close">
          <IconX size={16} />
        </ActionIcon>
      </div>

      <div className="cluster-section">
        <div className="cluster-label">Criteria</div>
        <Group gap="xs">
          {CRITERIA.map((c) => (
            <Checkbox
              key={c.id}
              size="xs"
              label={c.label}
              checked={criteria.has(c.id)}
              disabled={c.id === 'lifeDomain'}
              onChange={() => toggleCriterion(c.id)}
            />
          ))}
        </Group>
      </div>

      <div className="cluster-section cluster-row">
        <Text component="label" className="cluster-label">
          Method
        </Text>
        <Select
          size="xs"
          w={180}
          data={CLUSTER_METHODS.map((m) => ({ value: m.id, label: m.label }))}
          value={method}
          onChange={(v) => v && setMethod(v as ClusterMethodId)}
          allowDeselect={false}
        />
      </div>

      <div className="cluster-section cluster-row">
        <Text span className="cluster-label">
          Gaps
        </Text>
        <Radio.Group value={gap} onChange={(v) => setGap(v as GapHandling)}>
          <Group gap="sm">
            <Radio size="xs" value="pairwise" label="Pairwise" />
            <Radio size="xs" value="global" label="Global" />
          </Group>
        </Radio.Group>
      </div>

      <Group gap="xs" mt="sm">
        <Button onClick={() => void compute()} loading={group.isComputing()}>
          Compute
        </Button>
        <Button variant="default" onClick={() => group.clear()} disabled={!group.hasGroups()}>
          No clusters
        </Button>
      </Group>

      {infos.length > 0 && (
        <div className="cluster-legend">
          {infos.map((c) => (
            <div key={c.id} className="cluster-item">
              <span className="cluster-swatch" style={{ background: c.color }} />
              <TextInput
                size="xs"
                variant="unstyled"
                className="cluster-name"
                defaultValue={c.name}
                onBlur={(e) => group.renameCluster(c.id, e.currentTarget.value.trim() || c.name)}
              />
              <span className="cluster-size">{c.size}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
