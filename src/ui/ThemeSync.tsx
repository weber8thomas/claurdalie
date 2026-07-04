import { useEffect } from 'react'
import type { EditorController } from '../editor/EditorController'
import { useEditorSnapshot } from './useEditor'

/**
 * Reflects the editor's theme onto <html data-theme> for CSS tokens (and, via
 * `onDark`, lifts it up so MantineProvider can force the matching color scheme).
 * The editor's `dark` flag stays the single source of truth for the whole UI.
 */
export function ThemeSync({ ctrl, onDark }: { ctrl: EditorController; onDark?: (dark: boolean) => void }) {
  const { dark } = useEditorSnapshot(ctrl)
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    onDark?.(dark)
  }, [dark, onDark])
  return null
}
