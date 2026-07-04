import { useState, useSyncExternalStore } from 'react'
import { Button, Checkbox, Group, SegmentedControl, Text, TextInput } from '@mantine/core'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import type { EditorController } from '../editor/EditorController'
import type { MotifModel, MotifScope } from '../analysis/motif/MotifModel'
import { FloatingPanel } from './panel/FloatingPanel'

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
    () =>
      `${model.getPattern()}|${model.matchCount()}|${model.currentIndex()}|${model.isActive()}|${model.errorText() ?? ''}|${model.getScope()}|${model.hasGroups()}|${model.isComputing()}`,
  )
  const [text, setText] = useState(model.getPattern())

  const count = model.matchCount()
  const err = model.errorText()
  const idx = model.currentIndex()
  const computing = model.isComputing()

  const onChange = (v: string) => {
    setText(v)
    model.setPattern(v)
  }

  return (
    <FloatingPanel
      panelKey="motif"
      title="Motif search"
      onClose={onClose}
      defaultPos="top-right"
      defaultSize={{ w: 320, h: 220 }}
      minSize={{ w: 280, h: 180 }}
      maxSize={{ w: 520, h: 420 }}
    >
      <div className="motif-body">
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
          {computing ? 'computing…' : count === 0 ? (text.trim() && !err ? 'no matches' : '') : `${idx + 1} / ${count}`}
        </Text>
      </Group>

      {model.hasGroups() && (
        <Group gap="xs" mt="xs" align="center">
          <Text fz="xs" c="dimmed">
            Scope
          </Text>
          <SegmentedControl
            size="xs"
            value={model.getScope()}
            onChange={(v) => model.setScope(v as MotifScope)}
            data={[
              { value: 'sequence', label: 'Per sequence' },
              { value: 'group', label: 'Per group' },
            ]}
          />
          <Text fz="xs" c="dimmed" title="With a grouping active, 'Per group' highlights one representative sequence per group instead of every member">
            {model.getScope() === 'group' ? 'one row per group' : 'every sequence'}
          </Text>
        </Group>
      )}
      </div>
    </FloatingPanel>
  )
}
