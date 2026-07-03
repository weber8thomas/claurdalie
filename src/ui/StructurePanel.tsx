import { useEffect, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { StructureController } from '../structure/StructureController'
import { createStructureViewer, type StructureViewer, type ColorMode, type Representation } from '../structure/viewer'
import { useEditorSnapshot } from './useEditor'
import { Icon } from './Icon'
import type { HoverPayload } from '../editor/interaction'

const MIN_W = 240
const MIN_H = 240
const MAX_W = 720
const MAX_H = 760

interface Props {
  ctrl: EditorController
  structure: StructureController
  hover: HoverPayload | null
  width: number
  height: number
  onResize: (w: number, h: number) => void
  onClose: () => void
  onToast: (msg: string) => void
}

function useStructureState(structure: StructureController) {
  useSyncExternalStore(structure.subscribe, structure.getVersion, structure.getVersion)
  return structure.snapshot()
}

const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: 'plddt', label: 'pLDDT' },
  { id: 'model', label: 'Model' },
  { id: 'spectrum', label: 'Rainbow' },
  { id: 'chain', label: 'Chain' },
]
const VIEWS: { id: Representation; label: string }[] = [
  { id: 'cartoon', label: 'Cartoon' },
  { id: 'trace', label: 'Trace' },
  { id: 'stick', label: 'Stick' },
  { id: 'sphere', label: 'Sphere' },
]

export function StructurePanel({ ctrl, structure, hover, width, height, onResize, onClose, onToast }: Props) {
  const snap = useEditorSnapshot(ctrl)
  const st = useStructureState(structure)
  const hostRef = useRef<HTMLDivElement>(null)
  const foldFileRef = useRef<HTMLInputElement>(null)
  const compareFileRef = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<StructureViewer | null>(null)
  const [viewerReady, setViewerReady] = useState(false)
  const [viewerError, setViewerError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  // Create the dynamically-imported WebGL viewer once.
  useEffect(() => {
    let disposed = false
    const host = hostRef.current
    if (!host) return
    createStructureViewer(host, { dark: snap.dark })
      .then((v) => {
        if (disposed) return v.dispose()
        viewerRef.current = v
        v.onResiduePick((modelId, index) => structure.pick(modelId, index))
        setViewerReady(true)
      })
      .catch((e) => setViewerError(String(e?.message ?? e)))
    return () => {
      disposed = true
      viewerRef.current?.dispose()
      viewerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reconcile models whenever the set changes; re-center to include new ones.
  useEffect(() => {
    if (viewerReady) viewerRef.current?.setModels(structure.viewerModels(), true)
  }, [viewerReady, st.modelsRev, structure])
  useEffect(() => {
    if (viewerReady) viewerRef.current?.setColorMode(st.colorMode)
  }, [viewerReady, st.colorMode])
  useEffect(() => {
    if (viewerReady) viewerRef.current?.setRepresentation(st.representation)
  }, [viewerReady, st.representation])

  // Drive the 3D highlight from alignment hover (any folded sequence).
  useEffect(() => {
    const v = viewerRef.current
    if (!v || !viewerReady) return
    const t = hover ? structure.hoverTarget(hover.row, hover.col) : null
    v.highlightResidue(t?.modelId ?? null, t?.index ?? null)
  }, [hover, viewerReady, st.modelsRev, structure])

  // Resize the GL canvas when the panel box or fullscreen state changes.
  useEffect(() => {
    viewerRef.current?.resize()
  }, [width, height, fullscreen])

  const foldActive = () => {
    const selected = ctrl.selectedRowIdsInOrder()
    const ids = selected.length ? selected : snap.cursor ? [ctrl.store.rowIdAt(snap.cursor.row)] : []
    if (!ids.length) return
    onToast(ids.length > 1 ? `Folding ${ids.length} sequences…` : `Folding ${ctrl.store.rowName(ctrl.store.orderSnapshot().indexOf(ids[0]))}…`)
    void structure.foldRows(ids)
  }

  const saveImage = () => {
    const uri = viewerRef.current?.snapshot()
    if (!uri) return
    const a = document.createElement('a')
    a.href = uri
    a.download = 'structure.png'
    a.click()
    onToast('Saved structure.png')
  }

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const sx = e.clientX
    const sy = e.clientY
    const sw = width
    const sh = height
    const move = (ev: PointerEvent) => {
      // Bottom-left handle on a top-right-anchored panel: left edge & bottom edge.
      const w = Math.max(MIN_W, Math.min(MAX_W, sw - (ev.clientX - sx)))
      const h = Math.max(MIN_H, Math.min(MAX_H, sh + (ev.clientY - sy)))
      onResize(Math.round(w), Math.round(h))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      viewerRef.current?.resize()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const boxStyle = fullscreen ? undefined : { width, height }

  return (
    <div className={'structure-panel' + (fullscreen ? ' fullscreen' : '')} style={boxStyle}>
      {!fullscreen && <div className="sp-resize-bl" title="Resize" onPointerDown={startResize} />}
      <div className="sp-head">
        <span className="sp-title">3D structure</span>
        <button className="mm-close" title={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={() => setFullscreen((f) => !f)}>
          {fullscreen ? '🡖' : '⛶'}
        </button>
        <button className="mm-close" title="Hide structure panel" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="sp-toolbar">
        <button className="btn sp-btn" onClick={foldActive} disabled={st.busy || snap.rows === 0} title="Fold the selected sequence(s) via ESMFold (online)">
          {st.busy ? 'Folding…' : ctrl.selectedRowCount() > 1 ? `Fold ${ctrl.selectedRowCount()}` : 'Fold sequence'}
        </button>
        <button className="btn sp-btn" onClick={() => foldFileRef.current?.click()} title="Load a local PDB structure (offline)">
          Load PDB…
        </button>
        <button className="btn sp-btn" onClick={() => compareFileRef.current?.click()} disabled={st.models.length === 0} title="Load a known structure and superpose it onto a folded model">
          Compare…
        </button>
        <input ref={foldFileRef} type="file" accept=".pdb,.ent,.cif,.mmcif,.txt" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then((t) => { structure.loadFile(t, f.name); onToast(`Loaded ${f.name}`) }); e.target.value = '' }} />
        <input ref={compareFileRef} type="file" accept=".pdb,.ent,.cif,.mmcif,.txt" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then((t) => { structure.compareFile(t, f.name); onToast(`Comparing ${f.name}`) }); e.target.value = '' }} />
      </div>

      <div className="sp-controls">
        <div className="sp-seg-group" role="group" aria-label="Color mode">
          <span className="sp-seg-label">Color</span>
          {COLOR_MODES.map((c) => (
            <button key={c.id} className={'sp-seg' + (st.colorMode === c.id ? ' active' : '')} onClick={() => structure.setColorMode(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="sp-seg-group" role="group" aria-label="Representation">
          <span className="sp-seg-label">View</span>
          {VIEWS.map((v) => (
            <button key={v.id} className={'sp-seg' + (st.representation === v.id ? ' active' : '')} onClick={() => structure.setRepresentation(v.id)}>
              {v.label}
            </button>
          ))}
          <button className="sp-seg" title="Reset view" onClick={() => viewerRef.current?.resetView()}>Reset</button>
          <button className="sp-seg" title="Save PNG image" onClick={saveImage} disabled={st.models.length === 0}>Image</button>
        </div>
      </div>

      <div className="sp-viewport">
        <div ref={hostRef} className="sp-host" />
        {viewerError && <div className="sp-overlay sp-error">3D viewer failed to load: {viewerError}</div>}
        {!viewerError && st.models.length === 0 && !st.busy && (
          <div className="sp-overlay sp-hint">
            Select one or more sequences, then press <b>Fold sequence</b> — or load a local PDB.
            <div className="sp-sub">ESMFold is online (≤400 residues); PDB loading works offline.</div>
          </div>
        )}
        {st.busy && <div className="sp-overlay sp-hint">{st.busyMessage}</div>}
        {st.error && !st.busy && (
          <div className="sp-overlay sp-error">
            {st.error}
            {st.errorKind === 'blocked' && <div className="sp-sub">Blocked by CORS/network policy — use <b>Load PDB…</b> for an offline structure.</div>}
          </div>
        )}
      </div>

      {st.models.length > 0 && (
        <div className="sp-models">
          {st.models.map((m) => (
            <div className={'sp-model' + (m.visible ? '' : ' hidden')} key={m.id} title={m.origin + (m.note ? ` — ${m.note}` : '')}>
              <span className="sp-swatch" style={{ background: m.color }} />
              <span className="sp-model-name">{m.label}</span>
              <span className="sp-model-meta">
                {m.residues} res{m.linked ? ' · linked' : ''}{m.kind === 'compare' ? ' · cmp' : ''}
              </span>
              <button
                className={'sp-model-eye' + (m.visible ? ' on' : '')}
                title={m.visible ? 'Hide from 3D view' : 'Show in 3D view'}
                onClick={() => structure.toggleModelVisibility(m.id)}
              >
                <Icon name={m.visible ? 'eye' : 'eye-off'} size={14} />
              </button>
              <button className="sp-model-x" title="Remove" onClick={() => structure.removeModel(m.id)}>×</button>
            </div>
          ))}
          {st.models.length > 1 && (
            <button className="sp-clear" onClick={() => structure.clearAll()}>Clear all</button>
          )}
        </div>
      )}
    </div>
  )
}
