import { Button, Group, Kbd, Modal, Stack, Text } from '@mantine/core'
import { SHORTCUTS } from '../editor/keymap'

const GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))]

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <Modal opened onClose={onClose} title="Keyboard shortcuts" size="lg" withCloseButton>
      <Stack gap="lg">
        <Stack gap="md">
          {GROUPS.map((g) => (
            <div key={g}>
              <Text fw={600} fz="xs" c="dimmed" tt="uppercase" mb={6} style={{ letterSpacing: '0.04em' }}>
                {g}
              </Text>
              <Stack gap={4}>
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <Group key={s.keys} justify="space-between" gap="sm" wrap="nowrap">
                    <Kbd>{s.keys}</Kbd>
                    <Text fz="sm" ta="right">
                      {s.action}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </div>
          ))}
        </Stack>

        <Text c="dimmed" fz="sm">
          Tip: turn on <strong>Edit mode</strong> (F2), then use Space / Delete and ⌘/Ctrl+← → to
          insert, remove and slide gaps. Shift-drag a residue to slide it. Select sequences by
          clicking their names — <strong>⌘/Ctrl-click</strong> to add others (even non-adjacent),{' '}
          <strong>Shift-click</strong> for a range — then drag any selected name (in Edit mode) to
          move them all together.
        </Text>

        <Group justify="flex-end">
          <Button onClick={onClose}>Close</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
