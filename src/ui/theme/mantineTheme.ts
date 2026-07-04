// Mantine theme for Claurdalie. This owns *component-level* styling (primary
// color, radius, spacing, typography, default props). The surface colors
// (bg/panel/border/text) stay in tokens.css so the canvas layer — which mirrors
// them in render/theme.ts — has a single place to track. mantine-overrides.css
// maps Mantine's surface CSS vars onto our --panel/--border/--text tokens so
// Mantine components follow [data-theme] together with everything else.

import { createTheme, type MantineColorsTuple } from '@mantine/core'

// Brand teal ramp. Shade 6 ≈ tokens --accent (#0d9488, light primary); the
// lighter shades (4/5) land near the dark accent (#2dd4bf) so filled controls
// read correctly on dark surfaces.
const teal: MantineColorsTuple = [
  '#e6faf6',
  '#c4f2e9',
  '#9fe8db',
  '#6fdccb',
  '#43ceb6',
  '#2dd4bf',
  '#0d9488',
  '#0b7d73',
  '#09635b',
  '#064b45',
]

// Danger ramp anchored on tokens --danger (#dc2626 light / #f87171 dark).
const danger: MantineColorsTuple = [
  '#fff0f0',
  '#ffdcdc',
  '#ffb8b8',
  '#f98f8f',
  '#f87171',
  '#ef4444',
  '#dc2626',
  '#b91c1c',
  '#991b1b',
  '#7f1d1d',
]

export const mantineTheme = createTheme({
  primaryColor: 'teal',
  primaryShade: { light: 6, dark: 5 },
  colors: { teal, danger },
  fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontFamilyMonospace: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
  headings: { fontFamily: "'Space Grotesk', 'Inter', system-ui, sans-serif" },
  defaultRadius: 'md',
  radius: { sm: '6px', md: '8px', lg: '12px' },
  // Mirror the --sp-1..5 4pt scale so nothing shifts.
  spacing: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px' },
  fontSizes: { xs: '11px', sm: '12px', md: '13px', lg: '15px', xl: '18px' },
  components: {
    Button: { defaultProps: { size: 'xs', radius: 'md' } },
    ActionIcon: { defaultProps: { variant: 'subtle', size: 'md', radius: 'md' } },
    Select: { defaultProps: { size: 'xs', checkIconPosition: 'right', comboboxProps: { withinPortal: true } } },
    TextInput: { defaultProps: { size: 'xs' } },
    NumberInput: { defaultProps: { size: 'xs' } },
    SegmentedControl: { defaultProps: { size: 'xs', radius: 'md' } },
    Checkbox: { defaultProps: { size: 'xs', radius: 'sm' } },
    Radio: { defaultProps: { size: 'xs' } },
    Modal: { defaultProps: { centered: true, radius: 'lg', overlayProps: { blur: 2 } } },
    Menu: { defaultProps: { shadow: 'md', width: 248, position: 'bottom-start', withinPortal: true } },
    Tooltip: { defaultProps: { openDelay: 400, withArrow: true } },
    Badge: { defaultProps: { radius: 'sm' } },
  },
})
