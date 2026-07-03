import { useSyncExternalStore } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { AlignController } from '../align/AlignController'
import { useEditorSnapshot } from './useEditor'

interface Props {
  ctrl: EditorController
  align: AlignController
  onClose: () => void
  onToast?: (msg: string) => void
}

/**
 * Re-align panel: pick an aligner and re-align the selected sequences, either in
 * place or into a new snapshot (which preserves the original). Chrome only — the
 * actual work and state live in AlignController.
 */
export function AlignPanel({ ctrl, align, onClose, onToast }: Props) {
  const snap = useEditorSnapshot(ctrl)
  useSyncExternalStore(align.subscribe, align.getVersion)
  const state = align.snapshot()
  const selected = snap.selectedRows
  const canRun = selected >= 2 && !state.busy

  const run = async (intoNewSnapshot: boolean) => {
    await align.realign(intoNewSnapshot)
    const after = align.snapshot()
    if (!after.error) onToast?.(intoNewSnapshot ? 'Re-aligned into a new snapshot' : 'Re-aligned selection')
  }

  return (
    <div className="align-panel">
      <div className="align-chrome">
        <span className="align-title">Re-align</span>
        <select
          className="select"
          value={state.alignerId}
          disabled={state.busy}
          onChange={(e) => align.setAligner(e.target.value)}
          title="Choose an aligner"
        >
          {state.aligners.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
              {a.needsNetwork ? ' · online' : ''}
            </option>
          ))}
        </select>
        <button className="align-close" title="Hide re-align" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="align-body">
        <button className="align-btn" disabled={!canRun} onClick={() => void run(false)}>
          Re-align selection
        </button>
        <button className="align-btn primary" disabled={!canRun} onClick={() => void run(true)}>
          Re-align → new snapshot
        </button>
        {state.busy && (
          <div className="align-status">
            <span>{state.busyMessage ?? 'Working…'}</span>
            <button className="align-cancel" onClick={() => align.cancel()}>
              Cancel
            </button>
          </div>
        )}
        {state.error && <div className="align-error">{state.error}</div>}
        {!state.busy && !state.error && selected < 2 && (
          <div className="align-note">Select at least two sequences (click names in the gutter), then re-align.</div>
        )}
      </div>
    </div>
  )
}
