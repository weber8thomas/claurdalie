import { useEffect } from 'react'
import type { EditorController } from '../editor/EditorController'
import { useEditorSnapshot } from './useEditor'

/** Reflects the editor's theme onto <html data-theme> for CSS tokens. */
export function ThemeSync({ ctrl }: { ctrl: EditorController }) {
  const { dark } = useEditorSnapshot(ctrl)
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])
  return null
}
