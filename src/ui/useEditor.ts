import { useSyncExternalStore } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { EditorSnapshot } from '../editor/EditorController'

/** Subscribe a component to controller snapshots (re-renders on version bump). */
export function useEditorSnapshot(ctrl: EditorController): EditorSnapshot {
  useSyncExternalStore(ctrl.subscribe, ctrl.getVersion, ctrl.getVersion)
  return ctrl.snapshot()
}
