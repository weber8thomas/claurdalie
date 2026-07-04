import { useState, useSyncExternalStore } from 'react'
import { ActionIcon, Button, Checkbox, Group, Text, TextInput } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconX } from '@tabler/icons-react'
import type { EditorController } from '../editor/EditorController'
import type { MotifModel } from '../analysis/motif/MotifModel'

interface Props {
  ctrl: EditorController
  model: MotifModel
  onClose: () => void
}

/**
 * Motif (GCG FindPatterns) search box. Chrome only — the matched residues are
 * drawn by the GridRenderer's high-contrast overlay, never in React.
 */
export function MotifSearch({ model, onClose }: Props) {
  useSyncExternalStore(
    (fn) => model.subscribe(fn),
    () => `${model.getPattern()}|${model.matchCount()}|${model.currentIndex()}|${model.isActive()}|${model.errorText() ?? ''}`,
  )
  const [text, setText] = useState(model.getPattern())

  const count = model.matchCount()
  const err = model.errorText()
  const idx = model.currentIndex()

  const onChange = (v: string) => {
    setText(v)
    model.setPattern(v)
  }

  return (
    <div className="motif-panel">
      <div className="panel-head">
        <span className="panel-title">Motif search</span>
        <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label="Close">
          <IconX size={16} />
        </ActionIcon>
      </div>

      <div className="cluster-section">
        <TextInput
          size="xs"
          value={text}
          placeholder="e.g. C-X-X-C  →  C(A,C,D){2}C"
          spellCheck={false}
          data-autofocus
          error={err || undefined}
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') model.findNext()
          }}
          styles={{ input: { fontFamily: 'var(--mono)' } }}
        />
        <Text fz="xs" c="dimmed" mt={6}>
          Residues, ambiguity <code>B Z X</code>, groups <code>(A,C)</code>, repeats <code>{'{m,n}'}</code>,{' '}
          <code>~</code> not, <code>&lt;</code>/<code>&gt;</code> anchors.
        </Text>
      </div>

      <Group gap="xs" mt="xs" align="center">
        <Button
          variant="default"
          size="compact-xs"
          leftSection={<IconChevronLeft size={14} />}
          onClick={() => model.findPrev()}
          disabled={count === 0}
        >
          Prev
        </Button>
        <Button
          variant="default"
          size="compact-xs"
          rightSection={<IconChevronRight size={14} />}
          onClick={() => model.findNext()}
          disabled={count === 0}
        >
          Next
        </Button>
        <Checkbox
          size="xs"
          label="Highlight"
          checked={model.isActive()}
          disabled={count === 0}
          onChange={(e) => model.setActive(e.currentTarget.checked)}
        />
        <Text fz="xs" c="dimmed">
          {count === 0 ? (text.trim() && !err ? 'no matches' : '') : `${idx + 1} / ${count}`}
        </Text>
      </Group>
    </div>
  )
}
