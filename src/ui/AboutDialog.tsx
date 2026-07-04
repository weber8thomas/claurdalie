import { Anchor, Button, Group, Modal, Stack, Text, Title } from '@mantine/core'
import { APP_VERSION, REPO_URL } from '../version'
import { BrandMark } from './BrandMark'

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal opened onClose={onClose} title="About" size="lg" withCloseButton>
      <Stack gap="md">
        <Group gap="sm" align="flex-start" wrap="nowrap">
          <BrandMark size={40} />
          <div>
            <Title order={2} fz="lg">
              Claurdalie{' '}
              <Text span c="dimmed" fz="sm" fw={500}>
                v{APP_VERSION}
              </Text>
            </Title>
            <Text c="dimmed" fz="sm" mt={2}>
              A fast, client-side multiple sequence alignment editor.
            </Text>
          </div>
        </Group>

        <Text fz="sm" lh={1.55}>
          Edit alignments entirely in your browser — insert and slide gaps, reorder sequences
          (contiguous or not), and color residues by physico-chemical properties (ClustalX, Zappo,
          Taylor, hydrophobicity). Built to stay smooth on very large alignments (thousands of
          sequences × tens of thousands of columns) with a virtualized canvas renderer. Nothing is
          uploaded — your data stays local.
        </Text>

        <Group justify="space-between" fz="xs">
          <Text c="dimmed" fz="xs">
            Vite · React · TypeScript · Canvas 2D
          </Text>
          <Anchor href={REPO_URL} target="_blank" rel="noreferrer" fz="xs">
            Source ↗
          </Anchor>
        </Group>

        <Group justify="flex-end">
          <Button onClick={onClose}>Close</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
