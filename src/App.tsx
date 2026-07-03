import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorController } from './editor/EditorController'
import { AlignmentCanvas } from './ui/AlignmentCanvas'
import { Toolbar } from './ui/Toolbar'
import { StatusBar } from './ui/StatusBar'
import { Minimap } from './ui/Minimap'
import { SchemeLegend } from './ui/SchemeLegend'
import { HelpOverlay } from './ui/HelpOverlay'
import { AboutDialog } from './ui/AboutDialog'
import { ThemeSync } from './ui/ThemeSync'
import { ContextMenu, type MenuState } from './ui/ContextMenu'
import { AATooltip } from './ui/AATooltip'
import { StructurePanel } from './ui/StructurePanel'
import { StructureController } from './structure/StructureController'
import { SnapshotBar } from './ui/SnapshotBar'
import { ScoresPanel } from './ui/ScoresPanel'
import { ProjectStore, type ProjectHost } from './project/ProjectStore'
import { ConservationModel } from './analysis/conservation/ConservationModel'
import type { SerializableModule } from './project/types'
import { loadPrefs, savePrefs } from './editor/persistence'
import type { Hit } from './render/GridRenderer'
import type { HoverPayload } from './editor/interaction'

export default function App() {
  const [ctrl, setCtrl] = useState<EditorController | null>(null)
  const [help, setHelp] = useState(false)
  const [about, setAbout] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [showLegend, setShowLegend] = useState(() => loadPrefs().showLegend ?? true)
  const [showMinimap, setShowMinimap] = useState(() => loadPrefs().showMinimap ?? true)
  const [showStructure, setShowStructure] = useState(() => loadPrefs().showStructure ?? false)
  const [showScores, setShowScores] = useState(() => loadPrefs().showScores ?? false)
  const [structure, setStructure] = useState<StructureController | null>(null)
  const [project, setProject] = useState<ProjectStore | null>(null)
  const [conservation, setConservation] = useState<ConservationModel | null>(null)
  const [minimapSize, setMinimapSize] = useState(() => {
    const p = loadPrefs()
    return { w: p.minimapW ?? 180, h: p.minimapH ?? 120 }
  })
  const [structureSize, setStructureSize] = useState(() => {
    const p = loadPrefs()
    return { w: p.structureW ?? 380, h: p.structureH ?? 460 }
  })
  const [tooltipEnabled, setTooltipEnabled] = useState(() => loadPrefs().tooltipEnabled ?? true)
  const [hover, setHover] = useState<HoverPayload | null>(null)
  const toastTimer = useRef(0)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2400)
  }, [])

  useEffect(() => {
    savePrefs({
      showLegend,
      showMinimap,
      showStructure,
      showScores,
      tooltipEnabled,
      minimapW: minimapSize.w,
      minimapH: minimapSize.h,
      structureW: structureSize.w,
      structureH: structureSize.h,
    })
  }, [showLegend, showMinimap, showStructure, showScores, tooltipEnabled, minimapSize, structureSize])

  // The structure controller lives alongside the editor and survives panel
  // open/close so a folded structure isn't lost when the panel is toggled.
  useEffect(() => {
    if (!ctrl) return
    const sc = new StructureController(ctrl)
    setStructure(sc)
    return () => {
      sc.destroy()
      setStructure(null)
    }
  }, [ctrl])

  // The Snapshot spine + conservation model. Every analytical module registers
  // as a snapshot slice so switching instances restores exact state; a "view"
  // slice carries the scheme/scroll/cursor so the display is restored too.
  useEffect(() => {
    if (!ctrl) return
    const model = new ConservationModel(ctrl)
    const host: ProjectHost = {
      captureSequences: () => ctrl.store.toSequences(),
      loadSequences: (seqs) => ctrl.loadSnapshotSequences(seqs),
      sequenceCount: () => ctrl.store.height,
      columnCount: () => ctrl.store.width,
    }
    const proj = new ProjectStore(host)
    const viewSlice: SerializableModule<ReturnType<EditorController['viewState']>> = {
      sliceKey: 'view',
      serialize: () => ctrl.viewState(),
      hydrate: (s) => ctrl.applyViewState(s),
    }
    proj.register(model)
    proj.register(viewSlice)
    proj.init('Original')
    setConservation(model)
    setProject(proj)
    return () => {
      model.destroy()
      setConservation(null)
      setProject(null)
    }
  }, [ctrl])

  const toggleHelp = useCallback(() => setHelp((h) => !h), [])
  const openContextMenu = useCallback((x: number, y: number, hit: Hit) => setMenu({ x, y, hit }), [])

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && ctrl) {
      ctrl.loadFasta(await file.text())
      showToast(`Imported ${file.name} — ${ctrl.store.height} sequences`)
    }
  }

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault()
        if (!dragging) setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setDragging(false)
      }}
      onDrop={onDrop}
    >
      {ctrl && (
        <Toolbar
          ctrl={ctrl}
          onToast={showToast}
          onToggleHelp={toggleHelp}
          onAbout={() => setAbout(true)}
          showLegend={showLegend}
          showMinimap={showMinimap}
          showStructure={showStructure}
          showScores={showScores}
          tooltipEnabled={tooltipEnabled}
          onToggleLegend={() => setShowLegend((s) => !s)}
          onToggleMinimap={() => setShowMinimap((s) => !s)}
          onToggleStructure={() => setShowStructure((s) => !s)}
          onToggleScores={() => setShowScores((s) => !s)}
          onToggleTooltip={() => setTooltipEnabled((s) => !s)}
        />
      )}
      {ctrl && project && <SnapshotBar project={project} onToast={showToast} />}
      <div className="main">
        <AlignmentCanvas
          onReady={setCtrl}
          onToggleHelp={toggleHelp}
          onContextMenu={openContextMenu}
          onHover={setHover}
        />
        {ctrl && showLegend && <SchemeLegend ctrl={ctrl} onClose={() => setShowLegend(false)} />}
        {ctrl && showMinimap && (
          <Minimap
            ctrl={ctrl}
            width={minimapSize.w}
            height={minimapSize.h}
            onResize={(w, h) => setMinimapSize({ w, h })}
            onClose={() => setShowMinimap(false)}
          />
        )}
        {ctrl && structure && showStructure && (
          <StructurePanel
            ctrl={ctrl}
            structure={structure}
            hover={hover}
            width={structureSize.w}
            height={structureSize.h}
            onResize={(w, h) => setStructureSize({ w, h })}
            onClose={() => setShowStructure(false)}
            onToast={showToast}
          />
        )}
        {dragging && <div className="dropzone">Drop a FASTA file to load</div>}
      </div>
      {ctrl && conservation && showScores && (
        <ScoresPanel ctrl={ctrl} model={conservation} onClose={() => setShowScores(false)} />
      )}
      {ctrl && <StatusBar ctrl={ctrl} onAbout={() => setAbout(true)} />}
      {ctrl && <ThemeSync ctrl={ctrl} />}
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      {ctrl && menu && (
        <ContextMenu ctrl={ctrl} menu={menu} onClose={() => setMenu(null)} onToast={showToast} />
      )}
      {ctrl && hover && tooltipEnabled && !menu && <AATooltip ctrl={ctrl} hover={hover} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
