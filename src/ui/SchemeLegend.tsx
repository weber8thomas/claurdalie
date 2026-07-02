import type { EditorController } from '../editor/EditorController'
import { useEditorSnapshot } from './useEditor'
import { SCHEME_LUTS } from '../color/schemes'
import { CODE_TO_CHAR, AMINO_ACID_CODES } from '../core/alphabet'
import { toCss, luminance } from '../color/scheme'

const LABELS: Record<string, string> = {
  clustal: 'ClustalX — colored where the column is conserved',
  zappo: 'Zappo — by physico-chemical property',
  taylor: 'Taylor — one color per residue',
  hydro: 'Hydrophobicity (Kyte–Doolittle)',
}

export function SchemeLegend({ ctrl }: { ctrl: EditorController }) {
  const snap = useEditorSnapshot(ctrl)
  const lut = SCHEME_LUTS[snap.schemeId]
  if (!lut) return null

  return (
    <div className="legend">
      <h4>{LABELS[snap.schemeId] ?? snap.schemeId}</h4>
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
    </div>
  )
}
