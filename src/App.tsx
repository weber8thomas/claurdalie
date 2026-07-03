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
import { ClusterDialog } from './ui/ClusterDialog'
import { TreePanel } from './ui/TreePanel'
import { AlignPanel } from './ui/AlignPanel'
import { IdentityDialog } from './ui/IdentityDialog'
import { MotifSearch } from './ui/MotifSearch'
import { BarcodePanel } from './ui/BarcodePanel'
import { MotifModel } from './analysis/motif/MotifModel'
import { AlignController } from './align/AlignController'
import { ProjectStore, type ProjectHost } from './project/ProjectStore'
import { loadProject, saveProject } from './project/idb'
import { ConservationModel } from './analysis/conservation/ConservationModel'
import { GroupModel } from './analysis/cluster/GroupModel'
import { TreeModel } from './tree/TreeModel'
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
  const [showCluster, setShowCluster] = useState(false)
  const [showTree, setShowTree] = useState(false)
  const [showAlign, setShowAlign] = useState(false)
  const [showIdentity, setShowIdentity] = useState(false)
  const [showMotif, setShowMotif] = useState(false)
  const [showBarcode, setShowBarcode] = useState(() => loadPrefs().showBarcode ?? false)
  const [scoresH, setScoresH] = useState(() => loadPrefs().scoresH ?? 104)
  const [structure, setStructure] = useState<StructureController | null>(null)
  const [project, setProject] = useState<ProjectStore | null>(null)
  const [conservation, setConservation] = useState<ConservationModel | null>(null)
  const [groups, setGroups] = useState<GroupModel | null>(null)
  const [tree, setTree] = useState<TreeModel | null>(null)
  const [motif, setMotif] = useState<MotifModel | null>(null)
  const [align, setAlign] = useState<AlignController | null>(null)
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
      showBarcode,
      scoresH,
      tooltipEnabled,
      minimapW: minimapSize.w,
      minimapH: minimapSize.h,
      structureW: structureSize.w,
      structureH: structureSize.h,
    })
  }, [showLegend, showMinimap, showStructure, showScores, showBarcode, scoresH, tooltipEnabled, minimapSize, structureSize])

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
    const groupModel = new GroupModel(ctrl)
    const treeModel = new TreeModel(ctrl)
    const motifModel = new MotifModel(ctrl)
    // Per-group conservation tracks: feed group subsets to the conservation model
    // and recompute shown tracks whenever the grouping changes.
    model.setGroupProvider(() => groupModel.groups().map((g) => ({ id: g.clusterId, rows: g.rows })))
    const offGroups = groupModel.subscribe(() => model.refresh())

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
    // Groups hydrate BEFORE conservation so per-group tracks are available when
    // conservation recomputes on a snapshot switch.
    proj.register(groupModel)
    proj.register(model)
    proj.register(treeModel)
    proj.register(motifModel)
    proj.register(viewSlice)
    proj.init('Original')

    // Auto-persist the working project to IndexedDB (debounced), and restore any
    // previously saved state on load. The seed above keeps the UI live while the
    // async restore runs; the `restoring` guard stops the restore from re-saving.
    //
    // Persistence must never make the editor feel slow, so we only save on real
    // CONTENT/structure changes (edits, reorder, load, snapshot ops) — never on
    // cursor moves, selection, or zoom — debounce generously, and skip very large
    // alignments whose full serialize would jank the main thread (Export still
    // works manually for those).
    const AUTOSAVE_CELL_CAP = 400_000
    let restoring = true
    let saveTimer = 0
    let lastContentVersion = ctrl.getContentVersion()
    const scheduleSave = () => {
      if (restoring) return
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        if (ctrl.store.height * ctrl.store.width > AUTOSAVE_CELL_CAP) return
        void proj.toFile().then(saveProject).catch(() => {})
      }, 1500)
    }
    const offProjSave = proj.subscribe(scheduleSave)
    const offCtrlSave = ctrl.subscribe(() => {
      const v = ctrl.getContentVersion()
      if (v === lastContentVersion) return // cursor / selection / zoom — not persisted state
      lastContentVersion = v
      scheduleSave()
    })
    void (async () => {
      try {
        const saved = await loadProject()
        if (saved) await proj.fromFile(saved)
      } catch {
        // Corrupt / unreadable working state — keep the freshly seeded project.
      } finally {
        restoring = false
      }
    })()

    const alignCtrl = new AlignController(ctrl, proj)

    setConservation(model)
    setGroups(groupModel)
    setTree(treeModel)
    setMotif(motifModel)
    setProject(proj)
    setAlign(alignCtrl)
    return () => {
      offGroups()
      offProjSave()
      offCtrlSave()
      window.clearTimeout(saveTimer)
      model.destroy()
      groupModel.destroy()
      treeModel.destroy()
      motifModel.destroy()
      alignCtrl.destroy()
      setConservation(null)
      setGroups(null)
      setTree(null)
      setMotif(null)
      setProject(null)
      setAlign(null)
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
          showCluster={showCluster}
          showTree={showTree}
          showAlign={showAlign}
          showIdentity={showIdentity}
          showMotif={showMotif}
          showBarcode={showBarcode}
          tooltipEnabled={tooltipEnabled}
          onToggleLegend={() => setShowLegend((s) => !s)}
          onToggleMinimap={() => setShowMinimap((s) => !s)}
          onToggleStructure={() => setShowStructure((s) => !s)}
          onToggleScores={() => setShowScores((s) => !s)}
          onToggleCluster={() => setShowCluster((s) => !s)}
          onToggleTree={() => setShowTree((s) => !s)}
          onToggleAlign={() => setShowAlign((s) => !s)}
          onToggleIdentity={() => setShowIdentity((s) => !s)}
          onToggleMotif={() => setShowMotif((s) => !s)}
          onToggleBarcode={() => setShowBarcode((s) => !s)}
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
            conservation={conservation}
            group={groups}
            onResize={(w, h) => setMinimapSize({ w, h })}
            onClose={() => setShowMinimap(false)}
          />
        )}
        {ctrl && groups && showCluster && (
          <ClusterDialog ctrl={ctrl} group={groups} onClose={() => setShowCluster(false)} onToast={showToast} />
        )}
        {ctrl && showIdentity && (
          <IdentityDialog ctrl={ctrl} group={groups} onClose={() => setShowIdentity(false)} onToast={showToast} />
        )}
        {ctrl && motif && showMotif && (
          <MotifSearch ctrl={ctrl} model={motif} onClose={() => setShowMotif(false)} />
        )}
        {ctrl && tree && showTree && (
          <TreePanel ctrl={ctrl} model={tree} group={groups} onClose={() => setShowTree(false)} onToast={showToast} />
        )}
        {ctrl && align && showAlign && (
          <AlignPanel ctrl={ctrl} align={align} onClose={() => setShowAlign(false)} onToast={showToast} />
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
      {ctrl && groups && showBarcode && (
        <BarcodePanel ctrl={ctrl} group={groups} motif={motif} onClose={() => setShowBarcode(false)} />
      )}
      {ctrl && conservation && showScores && (
        <ScoresPanel
          ctrl={ctrl}
          model={conservation}
          group={groups}
          height={scoresH}
          onResize={setScoresH}
          onClose={() => setShowScores(false)}
        />
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
