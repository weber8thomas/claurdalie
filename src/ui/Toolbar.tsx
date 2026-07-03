import { useRef } from 'react'
import type { EditorController } from '../editor/EditorController'
import { useEditorSnapshot } from './useEditor'
import { Icon } from './Icon'

/** Brand mark: a tiny colored alignment tile (residues + a gap). */
function BrandMark() {
  const cells: [number, number, string, number?][] = [
    [14, 16, '#2bb3a3'], [33, 16, '#f3a83c'], [52, 16, '#5b7cf0'], [71, 16, '#ef5d6c'],
    [14, 40, '#f3a83c'], [33, 40, '#5b7cf0'], [52, 40, '#2bb3a3', 0.22], [71, 40, '#2bb3a3'],
    [14, 64, '#5b7cf0'], [33, 64, '#ef5d6c'], [52, 64, '#f3a83c'], [71, 64, '#2bb3a3'],
  ]
  return (
    <svg className="brand-mark" viewBox="0 0 100 100" width="22" height="22" aria-hidden="true">
      <rect width="100" height="100" rx="22" fill="#12141c" />
      {cells.map(([x, y, fill, op], i) => (
        <rect key={i} x={x} y={y} width="15" height="18" rx="3" fill={fill} opacity={op ?? 1} />
      ))}
    </svg>
  )
}

interface Props {
  ctrl: EditorController
  onToast: (msg: string) => void
  onToggleHelp: () => void
  onAbout: () => void
  showLegend: boolean
  showMinimap: boolean
  showStructure: boolean
  showScores: boolean
  showCluster: boolean
  showTree: boolean
  showAlign: boolean
  showIdentity: boolean
  showMotif: boolean
  showBarcode: boolean
  tooltipEnabled: boolean
  onToggleLegend: () => void
  onToggleMinimap: () => void
  onToggleStructure: () => void
  onToggleScores: () => void
  onToggleCluster: () => void
  onToggleTree: () => void
  onToggleAlign: () => void
  onToggleIdentity: () => void
  onToggleMotif: () => void
  onToggleBarcode: () => void
  onToggleTooltip: () => void
}

const SCHEMES = [
  { id: 'clustal', label: 'ClustalX (dynamic)' },
  { id: 'zappo', label: 'Zappo' },
  { id: 'taylor', label: 'Taylor' },
  { id: 'hydro', label: 'Hydrophobicity' },
  { id: 'plain', label: 'Plain' },
]

export function Toolbar({
  ctrl,
  onToast,
  onToggleHelp,
  onAbout,
  showLegend,
  showMinimap,
  showStructure,
  showScores,
  showCluster,
  showTree,
  showAlign,
  showIdentity,
  showMotif,
  showBarcode,
  tooltipEnabled,
  onToggleLegend,
  onToggleMinimap,
  onToggleStructure,
  onToggleScores,
  onToggleCluster,
  onToggleTree,
  onToggleAlign,
  onToggleIdentity,
  onToggleMotif,
  onToggleBarcode,
  onToggleTooltip,
}: Props) {
  const snap = useEditorSnapshot(ctrl)
  const fileRef = useRef<HTMLInputElement>(null)

  const onImport = async (file: File) => {
    ctrl.loadFasta(await file.text())
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
      ctrl.loadDemo()
      onToast('Loaded demo: cytochrome c (12 species)')
    } else if (kind === 'heavy') {
      onToast('Generating heavy dataset…')
      setTimeout(() => {
        ctrl.loadExample('heavy')
        onToast('Loaded heavy: 3,000 × 10,000')
      }, 10)
    } else if (kind === 'huge') {
      onToast('Generating huge dataset…')
      setTimeout(() => {
        ctrl.loadExample('huge')
        onToast('Loaded huge: 10,000 × 30,000')
      }, 10)
    }
  }

  const zoomPct = Math.round((snap.cellW / 16) * 100)

  return (
    <div className="toolbar">
      <div className="brand">
        <BrandMark />
        Claurdalie
      </div>

      <div className="tb-group">
        <button className="btn" onClick={() => fileRef.current?.click()} title="Import FASTA">
          <Icon name="import" /> Import
        </button>
        <button className="btn" onClick={onExport} title="Export FASTA">
          <Icon name="export" /> Export
        </button>
        <select
          className="select"
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
        <label className="tb-label" htmlFor="scheme">
          Color
        </label>
        <select id="scheme" className="select" value={snap.schemeId} onChange={(e) => ctrl.setSchemeId(e.target.value)}>
          {SCHEMES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="tb-group">
        <button className="icon" onClick={() => ctrl.zoomBy(1 / 1.15)} title="Zoom out (−)">
          <Icon name="minus" />
        </button>
        <span className="zoom-label">{zoomPct}%</span>
        <button className="icon" onClick={() => ctrl.zoomBy(1.15)} title="Zoom in (+)">
          <Icon name="plus" />
        </button>
        <button className="icon" onClick={() => ctrl.resetZoom()} title="Reset zoom (0)">
          <Icon name="fit" />
        </button>
      </div>

      <div className="tb-group">
        <button
          className={'btn' + (snap.cursorMode ? ' active' : '')}
          onClick={() => ctrl.toggleCursorMode()}
          title="Toggle edit mode (F2)"
        >
          <Icon name="edit" /> Edit
        </button>
        <button className="icon" disabled={!snap.canUndo} onClick={() => ctrl.undoAction()} title="Undo (⌘Z)">
          <Icon name="undo" />
        </button>
        <button className="icon" disabled={!snap.canRedo} onClick={() => ctrl.redoAction()} title="Redo (⌘⇧Z)">
          <Icon name="redo" />
        </button>
      </div>

      <div className="spacer" />

      <div className="tb-group">
        <button className={'icon' + (showLegend ? ' active' : '')} onClick={onToggleLegend} title="Color legend">
          <Icon name="palette" />
        </button>
        <button className={'icon' + (showMinimap ? ' active' : '')} onClick={onToggleMinimap} title="Minimap">
          <Icon name="map" />
        </button>
        <button
          className={'icon' + (showScores ? ' active' : '')}
          onClick={onToggleScores}
          title="Conservation scores"
        >
          <Icon name="chart" />
        </button>
        <button
          className={'icon' + (showCluster ? ' active' : '')}
          onClick={onToggleCluster}
          title="Clustering & groups"
        >
          <Icon name="group" />
        </button>
        <button
          className={'icon' + (showBarcode ? ' active' : '')}
          onClick={onToggleBarcode}
          title="Barcode (per-group conservation)"
        >
          <Icon name="barcode" />
        </button>
        <button className={'icon' + (showTree ? ' active' : '')} onClick={onToggleTree} title="Phylogenetic tree">
          <Icon name="tree" />
        </button>
        <button
          className={'icon' + (showIdentity ? ' active' : '')}
          onClick={onToggleIdentity}
          title="Sequence identity"
        >
          <Icon name="identity" />
        </button>
        <button
          className={'icon' + (showMotif ? ' active' : '')}
          onClick={onToggleMotif}
          title="Motif search (GCG FindPatterns)"
        >
          <Icon name="search" />
        </button>
        <button className={'icon' + (showAlign ? ' active' : '')} onClick={onToggleAlign} title="Re-align sequences">
          <Icon name="align" />
        </button>
        <button
          className={'icon' + (showStructure ? ' active' : '')}
          onClick={onToggleStructure}
          title="3D structure panel"
        >
          <Icon name="cube" />
        </button>
        <button
          className={'icon' + (tooltipEnabled ? ' active' : '')}
          onClick={onToggleTooltip}
          title="Residue tooltip on hover"
        >
          <Icon name="message" />
        </button>
      </div>

      <div className="tb-group" style={{ borderRight: 'none' }}>
        <button className="icon" onClick={() => ctrl.setDark(!snap.dark)} title="Toggle theme">
          <Icon name={snap.dark ? 'sun' : 'moon'} />
        </button>
        <button className="icon" onClick={onToggleHelp} title="Keyboard shortcuts (?)">
          <Icon name="help" />
        </button>
        <button className="icon" onClick={onAbout} title="About Claurdalie">
          <Icon name="info" />
        </button>
      </div>
    </div>
  )
}
