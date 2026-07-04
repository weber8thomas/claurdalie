import { useSyncExternalStore } from 'react'
import { Button, Group, Select, Text } from '@mantine/core'
import type { EditorController } from '../editor/EditorController'
import type { AlignController } from '../align/AlignController'
import { useEditorSnapshot } from './useEditor'
import { FloatingPanel } from './panel/FloatingPanel'

interface Props {
  ctrl: EditorController
  align: AlignController
  onClose: () => void
  onToast?: (msg: string) => void
}

/**
 * Re-align panel: pick an aligner and re-align the selected sequences, either in
 * place or into a new snapshot (which preserves the original). Chrome only — the
 * actual work and state live in AlignController.
 */
export function AlignPanel({ ctrl, align, onClose, onToast }: Props) {
  const snap = useEditorSnapshot(ctrl)
  useSyncExternalStore(align.subscribe, align.getVersion)
  const state = align.snapshot()
  const selected = snap.selectedRows
  const canRun = selected >= 2 && !state.busy

  const run = async (intoNewSnapshot: boolean) => {
    await align.realign(intoNewSnapshot)
    const after = align.snapshot()
    if (!after.error) onToast?.(intoNewSnapshot ? 'Re-aligned into a new snapshot' : 'Re-aligned selection')
  }

  return (
    <FloatingPanel
      panelKey="align"
      title="Re-align"
      onClose={onClose}
      defaultPos="top-right"
      defaultSize={{ w: 300, h: 180 }}
      minSize={{ w: 260, h: 150 }}
      maxSize={{ w: 460, h: 340 }}
      resize="width"
      controls={
        <Select
          size="xs"
          w={150}
          disabled={state.busy}
          data={state.aligners.map((a) => ({ value: a.id, label: a.label + (a.needsNetwork ? ' · online' : '') }))}
          value={state.alignerId}
          onChange={(v) => v && align.setAligner(v)}
          allowDeselect={false}
        />
      }
    >
      <div className="align-body">
        <Group gap="xs">
          <Button variant="default" disabled={!canRun} onClick={() => void run(false)}>
            Re-align selection
          </Button>
          <Button disabled={!canRun} onClick={() => void run(true)}>
            Re-align → new snapshot
          </Button>
        </Group>
        {state.busy && (
          <Group gap="xs" mt="xs">
            <Text fz="xs" c="dimmed">
              {state.busyMessage ?? 'Working…'}
            </Text>
            <Button variant="subtle" color="gray" size="compact-xs" onClick={() => align.cancel()}>
              Cancel
            </Button>
          </Group>
        )}
        {state.error && (
          <Text fz="xs" c="red" mt="xs">
            {state.error}
          </Text>
        )}
        {!state.busy && !state.error && selected < 2 && (
          <Text fz="xs" c="dimmed" mt="xs">
            Select at least two sequences (click names in the gutter), then re-align.
          </Text>
        )}
      </div>
    </FloatingPanel>
  )
}
