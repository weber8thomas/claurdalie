import { Button, ColorInput, SegmentedControl, Switch, Text } from '@mantine/core'
import type { EditorController } from '../editor/EditorController'
import { FloatingPanel } from './panel/FloatingPanel'
import { useDisplayStyle } from './displayStyleStore'
import type { GapGlyph } from '../render/GridRenderer'

interface Props {
  ctrl: EditorController
  onClose: () => void
}

const GAP_GLYPHS: { value: GapGlyph; label: string }[] = [
  { value: 'blank', label: 'Blank' },
  { value: 'dash', label: '– Dash' },
  { value: 'dot', label: '· Dot' },
  { value: 'cross', label: '+ Cross' },
]

const FILL_SWATCHES = ['#eef0f2', '#e2e8f0', '#dbe4ff', '#ffe3e3', '#e6fcf5', '#2a2c33', '#3a3f4b']

/**
 * Display style panel (View menu): customize how gaps and the grid whitespace
 * render. Values live in the display-style store (persisted) and are pushed to
 * the renderer via EditorController.setDisplayStyle.
 */
export function DisplayStylePanel({ ctrl, onClose }: Props) {
  const style = useDisplayStyle()

  // Any change re-pushes the whole style to the renderer.
  const apply = () => {
    const s = useDisplayStyle.getState()
    ctrl.setDisplayStyle({ gapGlyph: s.gapGlyph, gapFill: s.gapFill, gridLines: s.gridLines })
  }

  return (
    <FloatingPanel
      panelKey="display"
      title="Display style"
      onClose={onClose}
      defaultPos="top-left"
      defaultSize={{ w: 300, h: 300 }}
      minSize={{ w: 260, h: 220 }}
      maxSize={{ w: 420, h: 480 }}
      resize="width"
    >
      <div className="display-body">
        <div className="ds-row">
          <Text className="ds-label">Gap symbol</Text>
          <SegmentedControl
            size="xs"
            fullWidth
            value={style.gapGlyph}
            onChange={(v) => {
              style.setGapGlyph(v as GapGlyph)
              apply()
            }}
            data={GAP_GLYPHS}
          />
        </div>

        <div className="ds-row">
          <Text className="ds-label">Gap fill</Text>
          <ColorInput
            size="xs"
            format="hex"
            placeholder="none (grid background)"
            swatches={FILL_SWATCHES}
            value={style.gapFill ?? ''}
            onChange={(v) => {
              style.setGapFill(v ? v : null)
              apply()
            }}
            styles={{ input: { fontFamily: 'var(--mono)' } }}
          />
          {style.gapFill && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              mt={4}
              onClick={() => {
                style.setGapFill(null)
                apply()
              }}
            >
              Clear fill
            </Button>
          )}
        </div>

        <div className="ds-row">
          <Switch
            size="sm"
            label="Grid lines"
            checked={style.gridLines}
            onChange={(e) => {
              style.setGridLines(e.currentTarget.checked)
              apply()
            }}
          />
        </div>

        <Button
          size="compact-xs"
          variant="default"
          mt="auto"
          onClick={() => {
            style.reset()
            apply()
          }}
        >
          Reset to defaults
        </Button>
      </div>
    </FloatingPanel>
  )
}
