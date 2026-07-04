import { AA_INFO } from '../core/aaInfo'
import type { EditorController } from '../editor/EditorController'
import type { HoverPayload } from '../editor/interaction'
import type { VariantModel } from '../analysis/variant/VariantModel'
import { impactColor } from '../analysis/variant/types'

export function AATooltip({
  ctrl,
  hover,
  variant,
}: {
  ctrl: EditorController
  hover: HoverPayload
  variant?: VariantModel | null
}) {
  const { char, ungapped } = ctrl.describeCell(hover.row, hover.col)
  const info = AA_INFO[char] ?? AA_INFO['X']
  const isGap = char === '-'
  const v = variant?.variantAt(hover.row, hover.col) ?? null

  const left = Math.min(hover.clientX + 16, window.innerWidth - 236)
  const top = Math.min(hover.clientY + 18, window.innerHeight - (v ? 120 : 96))

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
      {v && (
        <div className="aa-tt-variant">
          <span className="vp-chip" style={{ background: v.score == null ? 'var(--muted)' : impactColor(v.score, ctrl.isDark()) }} />
          variant {v.from}→{v.to}
          {v.score != null ? ` · impact ${v.score} (${v.band})` : ' · unscored'}
        </div>
      )}
    </div>
  )
}
