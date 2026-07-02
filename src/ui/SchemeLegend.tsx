import { useState } from 'react'
import type { EditorController } from '../editor/EditorController'
import { useEditorSnapshot } from './useEditor'
import { SCHEME_LUTS } from '../color/schemes'
import { CODE_TO_CHAR, AMINO_ACID_CODES } from '../core/alphabet'
import { toCss, luminance } from '../color/scheme'

const LABELS: Record<string, string> = {
  clustal: 'ClustalX — colored where conserved',
  zappo: 'Zappo — physico-chemical property',
  taylor: 'Taylor — one color per residue',
  hydro: 'Hydrophobicity (Kyte–Doolittle)',
}

export function SchemeLegend({ ctrl, onClose }: { ctrl: EditorController; onClose: () => void }) {
  const snap = useEditorSnapshot(ctrl)
  const [collapsed, setCollapsed] = useState(false)
  const lut = SCHEME_LUTS[snap.schemeId]

  return (
    <div className="legend">
      <div className="legend-head">
        <button
          className="legend-toggle"
          title={collapsed ? 'Expand' : 'Collapse'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <h4>{LABELS[snap.schemeId] ?? snap.schemeId}</h4>
        <button className="legend-close" title="Hide legend" onClick={onClose}>
          ×
        </button>
      </div>
      {!collapsed &&
        (lut ? (
          <div className="swatches">
            {AMINO_ACID_CODES.map((code) => {
              const c = lut[code]
              const bg = c ?? (snap.dark ? 0x2a2c33 : 0xeaecef)
              const fg = luminance(bg) > 140 ? '#111' : '#fff'
              return (
                <span key={code} className="sw" style={{ background: toCss(bg), color: fg }}>
                  {CODE_TO_CHAR[code]}
                </span>
              )
            })}
          </div>
        ) : (
          <div className="hint" style={{ padding: '2px 0' }}>
            No per-residue colors for this scheme.
          </div>
        ))}
    </div>
  )
}
