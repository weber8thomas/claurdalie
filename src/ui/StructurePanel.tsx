import { useEffect, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { ActionIcon, Button, HoverCard, SegmentedControl, Text } from '@mantine/core'
import {
  IconArrowBackUp,
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconPhoto,
  IconRefresh,
  IconX,
} from '@tabler/icons-react'
import type { EditorController } from '../editor/EditorController'
import type { StructureController } from '../structure/StructureController'
import { createStructureViewer, type StructureViewer, type ColorMode, type Representation } from '../structure/viewer'
import { useEditorSnapshot } from './useEditor'
import type { HoverPayload } from '../editor/interaction'
import { FloatingPanel } from './panel/FloatingPanel'

const MIN_W = 240
const MIN_H = 240
const MAX_W = 720
const MAX_H = 760

interface Props {
  ctrl: EditorController
  structure: StructureController
  hover: HoverPayload | null
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
  { id: 'deviation', label: 'Difference' },
]
const VIEWS: { id: Representation; label: string }[] = [
  { id: 'cartoon', label: 'Cartoon' },
  { id: 'trace', label: 'Trace' },
  { id: 'stick', label: 'Stick' },
  { id: 'sphere', label: 'Sphere' },
]

/** AlphaFold-style pLDDT confidence band color for a mean score (0..100). */
function plddtBand(b: number): string {
  if (b >= 90) return '#0053d6'
  if (b >= 70) return '#65cbf3'
  if (b >= 50) return '#ffdb13'
  return '#ff7d45'
}

export function StructurePanel({ ctrl, structure, hover, onClose, onToast }: Props) {
  const snap = useEditorSnapshot(ctrl)
  const st = useStructureState(structure)
  const hostRef = useRef<HTMLDivElement>(null)
  const foldFileRef = useRef<HTMLInputElement>(null)
  const compareFileRef = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<StructureViewer | null>(null)
  const [viewerReady, setViewerReady] = useState(false)
  const [viewerError, setViewerError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

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

  // Keep the GL canvas in step with the panel body size (drag-resize, fullscreen,
  // dock) without threading width/height props — the FloatingPanel owns geometry.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !viewerReady) return
    const ro = new ResizeObserver(() => viewerRef.current?.resize())
    ro.observe(host)
    return () => ro.disconnect()
  }, [viewerReady])

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

  // Drive the 3D highlight: an externally-requested focus (e.g. a variant the
  // user clicked in the Variant panel) wins over transient alignment hover.
  useEffect(() => {
    const v = viewerRef.current
    if (!v || !viewerReady) return
    const t = st.focus ?? (hover ? structure.hoverTarget(hover.row, hover.col) : null)
    v.highlightResidue(t?.modelId ?? null, t?.index ?? null)
  }, [hover, st.focus, viewerReady, st.modelsRev, structure])

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

  return (
    <FloatingPanel
      panelKey="structure"
      title="3D structure"
      onClose={onClose}
      defaultPos="top-right"
      defaultSize={{ w: 380, h: 460 }}
      minSize={{ w: MIN_W, h: MIN_H }}
      maxSize={{ w: MAX_W, h: MAX_H }}
      resize="both"
      onGeometryChange={() => viewerRef.current?.resize()}
      bodyClassName="structure-fp"
    >
      <div className="sp-toolbar">
        <Button size="compact-xs" onClick={foldActive} loading={st.busy} disabled={snap.rows === 0} title="Fold the selected sequence(s) via ESMFold (online)">
          {ctrl.selectedRowCount() > 1 ? `Fold ${ctrl.selectedRowCount()}` : 'Fold sequence'}
        </Button>
        <Button size="compact-xs" variant="default" onClick={() => foldFileRef.current?.click()} title="Load a local PDB structure (offline)">
          Load PDB…
        </Button>
        <Button size="compact-xs" variant="default" onClick={() => compareFileRef.current?.click()} disabled={st.models.length === 0} title="Load a known structure and superpose it onto a folded model">
          Compare…
        </Button>
        <input ref={foldFileRef} type="file" accept=".pdb,.ent,.cif,.mmcif,.txt" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then((t) => { structure.loadFile(t, f.name); onToast(`Loaded ${f.name}`) }); e.target.value = '' }} />
        <input ref={compareFileRef} type="file" accept=".pdb,.ent,.cif,.mmcif,.txt" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then((t) => { structure.compareFile(t, f.name); onToast(`Comparing ${f.name}`) }); e.target.value = '' }} />
      </div>

      <div className="sp-controls">
        <div className="sp-seg-group">
          <span className="sp-seg-label">Color</span>
          <SegmentedControl
            size="xs"
            value={st.colorMode}
            onChange={(v) => structure.setColorMode(v as ColorMode)}
            data={COLOR_MODES.map((c) => ({ value: c.id, label: c.label }))}
          />
        </div>
        <div className="sp-seg-group">
          <span className="sp-seg-label">View</span>
          <SegmentedControl
            size="xs"
            value={st.representation}
            onChange={(v) => structure.setRepresentation(v as Representation)}
            data={VIEWS.map((v) => ({ value: v.id, label: v.label }))}
          />
          <ActionIcon variant="default" title="Reset view" onClick={() => viewerRef.current?.resetView()} aria-label="Reset view">
            <IconRefresh size={15} />
          </ActionIcon>
          <ActionIcon variant="default" title="Save PNG image" onClick={saveImage} disabled={st.models.length === 0} aria-label="Save image">
            <IconPhoto size={15} />
          </ActionIcon>
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
            <div className={'sp-model' + (m.visible ? '' : ' hidden')} key={m.id}>
              <HoverCard width={240} shadow="md" openDelay={120} withArrow position="left">
                <HoverCard.Target>
                  <div className="sp-model-info">
                    <span className="sp-swatch" style={{ background: m.color }} />
                    <span className="sp-model-name">{m.label}</span>
                    <span className="sp-model-meta">
                      {m.residues} res{m.meanPlddt != null ? ` · pLDDT ${Math.round(m.meanPlddt)}` : ''}
                    </span>
                  </div>
                </HoverCard.Target>
                <HoverCard.Dropdown>
                  <Text fz="sm" fw={600}>
                    {m.label}
                  </Text>
                  <Text fz="xs" c="dimmed">
                    {m.origin} · {m.kind}
                    {m.linked ? ' · linked to alignment' : ''}
                  </Text>
                  <Text fz="xs" mt={4}>
                    {m.residues} residues
                    {m.meanPlddt != null ? (
                      <>
                        {' · '}
                        <span
                          className="sp-plddt-chip"
                          style={{ background: plddtBand(m.meanPlddt) }}
                        />
                        mean pLDDT {m.meanPlddt.toFixed(1)}
                      </>
                    ) : (
                      ' · no confidence score'
                    )}
                  </Text>
                  {m.note && (
                    <Text fz="xs" mt={4} c="dimmed">
                      {m.note}
                    </Text>
                  )}
                </HoverCard.Dropdown>
              </HoverCard>
              <ActionIcon
                variant="subtle"
                color={m.visible ? 'teal' : 'gray'}
                size="sm"
                className="sp-model-eye"
                title={m.visible ? 'Hide from 3D view' : 'Show in 3D view'}
                onClick={() => structure.toggleModelVisibility(m.id)}
                aria-label="Toggle visibility"
              >
                {m.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
              </ActionIcon>
              <ActionIcon variant="subtle" color="gray" size="sm" title="Remove" onClick={() => structure.removeModel(m.id)} aria-label="Remove">
                <IconX size={14} />
              </ActionIcon>
            </div>
          ))}
          {st.models.length > 1 && (
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => structure.clearAll()}>
              Clear all
            </Button>
          )}
        </div>
      )}

      {st.history.length > 0 && (
        <div className="sp-history">
          <button className="sp-history-head" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen}>
            {historyOpen ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
            <span>Session history ({st.history.length})</span>
            {historyOpen && (
              <span
                className="sp-history-clear"
                role="button"
                tabIndex={0}
                title="Clear history"
                onClick={(e) => {
                  e.stopPropagation()
                  structure.clearHistory()
                }}
              >
                clear
              </span>
            )}
          </button>
          {historyOpen && (
            <div className="sp-history-list">
              {st.history.map((h) => (
                <div className={'sp-hist-item' + (h.present ? ' present' : '')} key={h.id}>
                  <span className="sp-swatch" style={{ background: h.color }} />
                  <span className="sp-model-name">{h.label}</span>
                  <span className="sp-model-meta">
                    {h.residues} res{h.meanPlddt != null ? ` · ${Math.round(h.meanPlddt)}` : ''}
                  </span>
                  {h.present ? (
                    <span className="sp-hist-tag">shown</span>
                  ) : (
                    <ActionIcon
                      variant="subtle"
                      color="teal"
                      size="sm"
                      title="Re-show this structure"
                      onClick={() => structure.restoreFromHistory(h.id)}
                      aria-label="Re-show structure"
                    >
                      <IconArrowBackUp size={14} />
                    </ActionIcon>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </FloatingPanel>
  )
}
