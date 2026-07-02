import { useRef } from 'react'
import type { EditorController } from '../editor/EditorController'
import { useEditorSnapshot } from './useEditor'
import { generateHeavy } from '../datasets/heavy'
import { parseFasta } from '../core/io/fasta'
import { LIGHT_FASTA } from '../datasets/light'

interface Props {
  ctrl: EditorController
  onToast: (msg: string) => void
  onToggleHelp: () => void
}

const SCHEMES = [
  { id: 'clustal', label: 'ClustalX (dynamic)' },
  { id: 'zappo', label: 'Zappo' },
  { id: 'taylor', label: 'Taylor' },
  { id: 'hydro', label: 'Hydrophobicity' },
  { id: 'plain', label: 'Plain' },
]

export function Toolbar({ ctrl, onToast, onToggleHelp }: Props) {
  const snap = useEditorSnapshot(ctrl)
  const fileRef = useRef<HTMLInputElement>(null)

  const onImport = async (file: File) => {
    const text = await file.text()
    ctrl.loadFasta(text)
    onToast(`Imported ${file.name} — ${ctrl.store.height} sequences`)
  }
  const onExport = () => {
    const blob = new Blob([ctrl.exportFasta()], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'alignment.fasta'
    a.click()
    URL.revokeObjectURL(url)
    onToast('Exported alignment.fasta')
  }
  const loadExample = (kind: string) => {
    if (kind === 'light') {
      ctrl.loadSequences(parseFasta(LIGHT_FASTA))
      onToast('Loaded demo: cytochrome c (12 species)')
    } else if (kind === 'heavy') {
      onToast('Generating heavy dataset…')
      setTimeout(() => {
        ctrl.loadSequences(generateHeavy({ rows: 3000, cols: 10000 }))
        onToast('Loaded heavy: 3,000 × 10,000')
      }, 10)
    } else if (kind === 'huge') {
      onToast('Generating huge dataset…')
      setTimeout(() => {
        ctrl.loadSequences(generateHeavy({ rows: 10000, cols: 30000, seed: 7 }))
        onToast('Loaded huge: 10,000 × 30,000')
      }, 10)
    }
  }

  const zoomPct = Math.round((snap.cellW / 16) * 100)

  return (
    <div className="toolbar">
      <div className="brand">
        <span className="dot" />
        Claurdalie
      </div>

      <div className="tb-group">
        <button onClick={() => fileRef.current?.click()} title="Import FASTA">
          ⬆ Import
        </button>
        <button onClick={onExport} title="Export FASTA">
          ⬇ Export
        </button>
        <select
          value=""
          onChange={(e) => {
            loadExample(e.target.value)
            e.target.value = ''
          }}
          title="Load example alignment"
        >
          <option value="">Examples…</option>
          <option value="light">Demo — cytochrome c</option>
          <option value="heavy">Heavy — 3k × 10k</option>
          <option value="huge">Huge — 10k × 30k</option>
        </select>
        <input
          ref={fileRef}
          type="file"
          accept=".fasta,.fa,.faa,.txt,.aln"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onImport(f)
            e.target.value = ''
          }}
        />
      </div>

      <div className="tb-group">
        <label className="hint" htmlFor="scheme">
          Color
        </label>
        <select id="scheme" value={snap.schemeId} onChange={(e) => ctrl.setSchemeId(e.target.value)}>
          {SCHEMES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="tb-group">
        <button className="icon" onClick={() => ctrl.zoomBy(1 / 1.15)} title="Zoom out (-)">
          −
        </button>
        <span className="zoom-label">{zoomPct}%</span>
        <button className="icon" onClick={() => ctrl.zoomBy(1.15)} title="Zoom in (+)">
          +
        </button>
        <button className="icon" onClick={() => ctrl.resetZoom()} title="Reset zoom (0)">
          ⤢
        </button>
      </div>

      <div className="tb-group">
        <button
          className={snap.cursorMode ? 'active' : ''}
          onClick={() => ctrl.toggleCursorMode()}
          title="Toggle cursor / edit mode (F2)"
        >
          ✎ Edit mode
        </button>
        <button className="icon" disabled={!snap.canUndo} onClick={() => ctrl.undoAction()} title="Undo (⌘Z)">
          ↶
        </button>
        <button className="icon" disabled={!snap.canRedo} onClick={() => ctrl.redoAction()} title="Redo (⌘⇧Z)">
          ↷
        </button>
      </div>

      <div className="spacer" />

      <div className="tb-group" style={{ borderRight: 'none' }}>
        <button className="icon" onClick={() => ctrl.setDark(!snap.dark)} title="Toggle theme">
          {snap.dark ? '☀' : '☾'}
        </button>
        <button className="icon" onClick={onToggleHelp} title="Keyboard shortcuts (?)">
          ?
        </button>
      </div>
    </div>
  )
}
