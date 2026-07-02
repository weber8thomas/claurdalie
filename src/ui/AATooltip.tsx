import { AA_INFO } from '../core/aaInfo'
import type { EditorController } from '../editor/EditorController'
import type { HoverPayload } from '../editor/interaction'

export function AATooltip({ ctrl, hover }: { ctrl: EditorController; hover: HoverPayload }) {
  const { char, ungapped } = ctrl.describeCell(hover.row, hover.col)
  const info = AA_INFO[char] ?? AA_INFO['X']
  const isGap = char === '-'

  const left = Math.min(hover.clientX + 16, window.innerWidth - 236)
  const top = Math.min(hover.clientY + 18, window.innerHeight - 96)

  return (
    <div className="aa-tooltip" style={{ left, top }}>
      <div className="aa-tt-head">
        <span className="aa-tt-code">{isGap ? '–' : char}</span>
        <span className="aa-tt-name">
          {info.name}
          {!isGap && info.three !== '—' ? ` (${info.three})` : ''}
        </span>
      </div>
      <div className="aa-tt-group">{info.group}</div>
      <div className="aa-tt-meta">
        col {hover.col + 1}
        {ungapped != null ? ` · residue ${ungapped}` : ''} · {ctrl.store.rowName(hover.row)}
      </div>
    </div>
  )
}
