// Declarative list of keyboard shortcuts, used both by the handler (for the
// help overlay) and as documentation.

export interface Shortcut {
  keys: string
  action: string
  group: string
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'F2', action: 'Toggle cursor (edit) mode', group: 'Modes' },
  { keys: 'Space', action: 'Insert gap at cursor (cursor mode)', group: 'Editing' },
  { keys: 'Delete', action: 'Delete gap at cursor', group: 'Editing' },
  { keys: 'Backspace', action: 'Delete gap to the left', group: 'Editing' },
  { keys: '⌘/Ctrl + ←/→', action: 'Shift sequence left / right', group: 'Editing' },
  { keys: '⌘/Ctrl + Z', action: 'Undo', group: 'History' },
  { keys: '⌘/Ctrl + ⇧ + Z', action: 'Redo', group: 'History' },
  { keys: '←/↑/→/↓', action: 'Move cursor (cursor mode) / scroll', group: 'Navigation' },
  { keys: '⇧ + arrows', action: 'Extend selection', group: 'Navigation' },
  { keys: 'Home / End', action: 'Jump to first / last column', group: 'Navigation' },
  { keys: 'PageUp / PageDown', action: 'Scroll one page', group: 'Navigation' },
  { keys: '⌘/Ctrl + A', action: 'Select all', group: 'Selection' },
  { keys: 'Esc', action: 'Clear selection / exit cursor mode', group: 'Selection' },
  { keys: '+ / -', action: 'Zoom in / out', group: 'View' },
  { keys: '0', action: 'Reset zoom', group: 'View' },
  { keys: '?', action: 'Toggle this help', group: 'View' },
]
