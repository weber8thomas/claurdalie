import { useEffect, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { StructureController } from '../structure/StructureController'
import { createStructureViewer, type StructureViewer } from '../structure/viewer'
import { useEditorSnapshot } from './useEditor'
import type { HoverPayload } from '../editor/interaction'

const MIN_W = 220
const MIN_H = 200
const MAX_W = 640
const MAX_H = 640

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

/** Subscribe to the structure controller's state. */
function useStructureState(structure: StructureController) {
  useSyncExternalStore(structure.subscribe, structure.getVersion, structure.getVersion)
  return structure.snapshot()
}

export function StructurePanel({ ctrl, structure, hover, width, height, onResize, onClose, onToast }: Props) {
  const snap = useEditorSnapshot(ctrl)
  const st = useStructureState(structure)
  const hostRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<StructureViewer | null>(null)
  const [viewerReady, setViewerReady] = useState(false)
  const [viewerError, setViewerError] = useState<string | null>(null)

  // Create the (dynamically-imported) WebGL viewer once the host div exists.
  useEffect(() => {
    let disposed = false
    const host = hostRef.current
    if (!host) return
    createStructureViewer(host, { dark: snap.dark })
      .then((v) => {
        if (disposed) {
          v.dispose()
          return
        }
        viewerRef.current = v
        v.onResiduePick((residue) => {
          if (residue == null) return
          const col = structure.columnForResidue(residue)
          const vrow = structure.referenceVisualIndex()
          if (col != null && vrow != null) ctrl.setCursor(vrow, col)
        })
        setViewerReady(true)
      })
      .catch((e) => setViewerError(String(e?.message ?? e)))
    return () => {
      disposed = true
      viewerRef.current?.dispose()
      viewerRef.current = null
    }
    // Recreate only if the host element identity changes (mount/unmount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push a new structure into the viewer when it changes.
  useEffect(() => {
    if (viewerReady && st.structure) viewerRef.current?.load(st.structure)
  }, [viewerReady, st.structure])

  // Drive the 3D highlight from alignment hover (only on the reference row).
  useEffect(() => {
    const v = viewerRef.current
    if (!v || !viewerReady) return
    if (hover && structure.isReferenceRow(hover.row)) {
      v.highlightResidue(structure.residueForColumn(hover.col))
    } else {
      v.highlightResidue(null)
    }
  }, [hover, viewerReady, st.structure, structure])

  const foldCursorRow = () => {
    if (snap.rows === 0) return
    const row = snap.cursor?.row ?? 0
    const id = ctrl.store.rowIdAt(row)
    onToast(`Folding ${ctrl.store.rowName(row)}…`)
    void structure.setReference(id)
  }

  const onPickFile = async (file: File) => {
    const text = await file.text()
    structure.loadFromFile(text, file.name)
    onToast(`Loaded structure ${file.name}`)
  }

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const sx = e.clientX
    const sy = e.clientY
    const sw = width
    const sh = height
    const move = (ev: PointerEvent) => {
      const w = Math.max(MIN_W, Math.min(MAX_W, sw - (ev.clientX - sx)))
      const h = Math.max(MIN_H, Math.min(MAX_H, sh - (ev.clientY - sy)))
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

  useEffect(() => {
    viewerRef.current?.resize()
  }, [width, height])

  const busy = st.phase === 'loading'

  return (
    <div className="structure-panel" style={{ width, height }}>
      <div className="sp-resize" title="Resize" onPointerDown={startResize} />
      <div className="sp-head">
        <span className="sp-title">3D structure</span>
        <button className="mm-close" title="Hide structure panel" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="sp-toolbar">
        <button className="btn sp-btn" onClick={foldCursorRow} disabled={busy || snap.rows === 0} title="Fold the sequence at the cursor via ESMFold (online)">
          {busy ? 'Folding…' : 'Fold sequence'}
        </button>
        <button className="btn sp-btn" onClick={() => fileRef.current?.click()} title="Load a local PDB structure (offline)">
          Load PDB…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdb,.ent,.cif,.mmcif,.txt"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onPickFile(f)
            e.target.value = ''
          }}
        />
      </div>

      <div className="sp-viewport">
        <div ref={hostRef} className="sp-host" />
        {viewerError && <div className="sp-overlay sp-error">3D viewer failed to load: {viewerError}</div>}
        {!viewerError && st.phase === 'idle' && (
          <div className="sp-overlay sp-hint">
            Put the cursor on a sequence and press <b>Fold sequence</b>, or load a local PDB.
            <div className="sp-sub">ESMFold is an online service (≤400 residues); PDB loading is offline.</div>
          </div>
        )}
        {busy && <div className="sp-overlay sp-hint">{st.message}</div>}
        {st.phase === 'error' && (
          <div className="sp-overlay sp-error">
            {st.message}
            {st.errorKind === 'blocked' && (
              <div className="sp-sub">
                The browser could not reach ESMFold (CORS/network policy). Use <b>Load PDB…</b> for an offline
                structure.
              </div>
            )}
            {(st.errorKind === 'network' || st.errorKind === 'invalid') && (
              <button className="btn sp-btn" style={{ marginTop: 8 }} onClick={() => structure.retry()}>
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      <div className="sp-status">
        {st.phase === 'ready' && st.structure ? (
          <>
            <span className="sp-src">{st.message}</span>
            {st.referenceName && <span className="sp-ref" title="Reference sequence"> · {st.referenceName}</span>}
            <span> · {st.structure.residueCount} res</span>
            {st.substitutions > 0 && (
              <span className="sp-warn" title="Non-standard residues substituted to canonical for folding">
                {' '}· {st.substitutions} subst.
              </span>
            )}
          </>
        ) : (
          <span className="sp-src">{st.sourceLabel}</span>
        )}
      </div>
    </div>
  )
}
