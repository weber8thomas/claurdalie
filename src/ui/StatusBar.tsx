import type { EditorController } from '../editor/EditorController'
import { useEditorSnapshot } from './useEditor'

export function StatusBar({ ctrl }: { ctrl: EditorController }) {
  const s = useEditorSnapshot(ctrl)
  const sel = s.selection
  const selInfo =
    sel &&
    `${Math.abs(sel.r1 - sel.r0) + 1}×${Math.abs(sel.c1 - sel.c0) + 1} selected`

  return (
    <div className="statusbar">
      <span className="chip">
        {s.rows.toLocaleString()} seqs × {s.cols.toLocaleString()} cols
      </span>
      {s.cursor && (
        <span>
          col <span className="chip">{s.cursor.col + 1}</span> · row{' '}
          <span className="chip">{s.cursor.row + 1}</span>
        </span>
      )}
      {s.cursorResidue && (
        <span>
          residue <span className="chip">{s.cursorResidue}</span>
          {s.cursorResidueIndex != null && <> · pos {s.cursorResidueIndex}</>}
        </span>
      )}
      {selInfo && <span className="chip">{selInfo}</span>}
      <span className="spacer" style={{ flex: 1 }} />
      {s.cursorMode && <span className="mode">EDIT MODE</span>}
      <span>zoom {Math.round((s.cellW / 16) * 100)}%</span>
      <span className="hint">Press ? for shortcuts</span>
    </div>
  )
}
