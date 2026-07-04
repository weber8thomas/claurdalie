import { useCallback, useEffect, useState } from 'react'
import { MantineProvider } from '@mantine/core'
import { Notifications, notifications } from '@mantine/notifications'
import { mantineTheme } from './ui/theme/mantineTheme'
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
import { ScoresPanel } from './ui/ScoresPanel'
import { ClusterDialog } from './ui/ClusterDialog'
import { TreePanel } from './ui/TreePanel'
import { AlignPanel } from './ui/AlignPanel'
import { IdentityDialog } from './ui/IdentityDialog'
import { MotifSearch } from './ui/MotifSearch'
import { BarcodePanel } from './ui/BarcodePanel'
import { VariantPanel } from './ui/VariantPanel'
import { MotifModel } from './analysis/motif/MotifModel'
import { VariantModel } from './analysis/variant/VariantModel'
import { AlignController } from './align/AlignController'
import { ProjectStore, type ProjectHost } from './project/ProjectStore'
import { loadProject, saveProject } from './project/idb'
import { ConservationModel } from './analysis/conservation/ConservationModel'
import { GroupModel } from './analysis/cluster/GroupModel'
import { TreeModel } from './tree/TreeModel'
import type { SerializableModule } from './project/types'
import { loadPrefs, savePrefs } from './editor/persistence'
import { usePanels } from './ui/panelsStore'
import { DockRail } from './ui/panel/DockRail'
import { DisplayStylePanel } from './ui/DisplayStylePanel'
import { displayStyleSnapshot } from './ui/displayStyleStore'
import type { Hit } from './render/GridRenderer'
import type { HoverPayload } from './editor/interaction'

export default function App() {
  const [ctrl, setCtrl] = useState<EditorController | null>(null)
  // The editor's `dark` flag is the single source of truth; seed from prefs for
  // first paint, then ThemeSync keeps it (and MantineProvider) in step.
  const [dark, setDark] = useState(() => loadPrefs().dark ?? false)
  const [help, setHelp] = useState(false)
  const [about, setAbout] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  // Panel visibility + tooltip now live in a small Zustand store so the menu bar
  // can toggle them directly (no more prop drilling); App just reads it.
  const panels = usePanels()
  const [variantPrefill, setVariantPrefill] = useState<{ seqName: string; position: number } | null>(null)
  const [scoresH, setScoresH] = useState(() => loadPrefs().scoresH ?? 104)
  const [structure, setStructure] = useState<StructureController | null>(null)
  const [project, setProject] = useState<ProjectStore | null>(null)
  const [conservation, setConservation] = useState<ConservationModel | null>(null)
  const [groups, setGroups] = useState<GroupModel | null>(null)
  const [tree, setTree] = useState<TreeModel | null>(null)
  const [motif, setMotif] = useState<MotifModel | null>(null)
  const [variant, setVariant] = useState<VariantModel | null>(null)
  const [align, setAlign] = useState<AlignController | null>(null)
  const [minimapSize, setMinimapSize] = useState(() => {
    const p = loadPrefs()
    return { w: p.minimapW ?? 180, h: p.minimapH ?? 120 }
  })
  const [hover, setHover] = useState<HoverPayload | null>(null)

  const showToast = useCallback((msg: string) => {
    notifications.show({ message: msg, autoClose: 2400, withBorder: true })
  }, [])

  // Panel-size prefs for the still-bespoke panels (minimap box + scores strip).
  // FloatingPanel windows persist their own geometry via panelsStore.
  useEffect(() => {
    savePrefs({
      scoresH,
      minimapW: minimapSize.w,
      minimapH: minimapSize.h,
    })
  }, [scoresH, minimapSize])

  // Seed the renderer with the persisted gap/whitespace display style once the
  // controller exists (the Display style panel updates it live thereafter).
  useEffect(() => {
    if (ctrl) ctrl.setDisplayStyle(displayStyleSnapshot())
  }, [ctrl])

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

  // Late-bind the structure controller into the variant model so a variant can
  // spotlight its residue in 3D (both are created in separate [ctrl] effects).
  useEffect(() => {
    variant?.setStructure(structure)
  }, [variant, structure])

  // The Snapshot spine + conservation model. Every analytical module registers
  // as a snapshot slice so switching instances restores exact state; a "view"
  // slice carries the scheme/scroll/cursor so the display is restored too.
  useEffect(() => {
    if (!ctrl) return
    const model = new ConservationModel(ctrl)
    const groupModel = new GroupModel(ctrl)
    const treeModel = new TreeModel(ctrl)
    const motifModel = new MotifModel(ctrl)
    // Variants score against conservation tracks + column stats; the structure
    // controller is late-bound (created in a sibling effect) for the 3D highlight.
    const variantModel = new VariantModel(ctrl, model, ctrl.stats)
    // Per-group conservation tracks: feed group subsets to the conservation model
    // and recompute shown tracks whenever the grouping changes.
    model.setGroupProvider(() => groupModel.groups().map((g) => ({ id: g.clusterId, rows: g.rows })))
    // Motif "per group" scope highlights one representative row per group.
    motifModel.setGroupProvider(() => groupModel.groups().map((g) => ({ rows: g.rows })))
    const offGroups = groupModel.subscribe(() => {
      model.refresh()
      motifModel.onGroupsChanged()
    })

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
    // Variants hydrate AFTER conservation so tracks are available when they rescore.
    proj.register(variantModel)
    proj.register(treeModel)
    proj.register(motifModel)
    proj.register(viewSlice)
    // Annotations seam (deferred): a future AnnotationModel implementing
    // SerializableModule with sliceKey 'annotations' would register here and then
    // ride every snapshot's slices — serializing into both the whole-project and
    // single-instance .clproj sessions with no format change.
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
    setVariant(variantModel)
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
      variantModel.destroy()
      alignCtrl.destroy()
      setConservation(null)
      setGroups(null)
      setTree(null)
      setMotif(null)
      setVariant(null)
      setProject(null)
      setAlign(null)
    }
  }, [ctrl])

  const toggleHelp = useCallback(() => setHelp((h) => !h), [])
  const openContextMenu = useCallback((x: number, y: number, hit: Hit) => setMenu({ x, y, hit }), [])
  const proposeVariant = useCallback(
    (hit: Hit) => {
      if (!ctrl) return
      const info = ctrl.describeCell(hit.row, hit.col)
      if (info.ungapped == null) return
      setVariantPrefill({ seqName: ctrl.store.rowName(hit.row), position: info.ungapped })
      panels.set('variant', true)
    },
    [ctrl, panels],
  )

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
    <MantineProvider theme={mantineTheme} forceColorScheme={dark ? 'dark' : 'light'}>
      <Notifications position="bottom-center" limit={3} />
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
          project={project}
          onToast={showToast}
          onToggleHelp={toggleHelp}
          onAbout={() => setAbout(true)}
        />
      )}
      <div className="main">
        <AlignmentCanvas
          onReady={setCtrl}
          onToggleHelp={toggleHelp}
          onContextMenu={openContextMenu}
          onHover={setHover}
        />
        {ctrl && panels.legend && <SchemeLegend ctrl={ctrl} onClose={() => panels.set('legend', false)} />}
        {ctrl && panels.minimap && (
          <Minimap
            ctrl={ctrl}
            width={minimapSize.w}
            height={minimapSize.h}
            conservation={conservation}
            group={groups}
            onResize={(w, h) => setMinimapSize({ w, h })}
            onClose={() => panels.set('minimap', false)}
          />
        )}
        {ctrl && groups && panels.cluster && (
          <ClusterDialog ctrl={ctrl} group={groups} onClose={() => panels.set('cluster', false)} onToast={showToast} />
        )}
        {ctrl && panels.identity && (
          <IdentityDialog ctrl={ctrl} group={groups} onClose={() => panels.set('identity', false)} onToast={showToast} />
        )}
        {ctrl && motif && panels.motif && (
          <MotifSearch ctrl={ctrl} model={motif} onClose={() => panels.set('motif', false)} />
        )}
        {ctrl && panels.display && <DisplayStylePanel ctrl={ctrl} onClose={() => panels.set('display', false)} />}
        {ctrl && tree && panels.tree && (
          <TreePanel ctrl={ctrl} model={tree} group={groups} onClose={() => panels.set('tree', false)} onToast={showToast} />
        )}
        {ctrl && align && panels.align && (
          <AlignPanel ctrl={ctrl} align={align} onClose={() => panels.set('align', false)} onToast={showToast} />
        )}
        {ctrl && structure && panels.structure && (
          <StructurePanel
            ctrl={ctrl}
            structure={structure}
            hover={hover}
            onClose={() => panels.set('structure', false)}
            onToast={showToast}
          />
        )}
        {ctrl && variant && panels.variant && (
          <VariantPanel
            ctrl={ctrl}
            structure={structure}
            model={variant}
            prefill={variantPrefill}
            onConsumePrefill={() => setVariantPrefill(null)}
            onClose={() => panels.set('variant', false)}
            onToast={showToast}
          />
        )}
        {dragging && <div className="dropzone">Drop a FASTA file to load</div>}
      </div>
      {ctrl && groups && panels.barcode && (
        <BarcodePanel ctrl={ctrl} group={groups} motif={motif} onClose={() => panels.set('barcode', false)} />
      )}
      {ctrl && conservation && panels.scores && (
        <ScoresPanel
          ctrl={ctrl}
          model={conservation}
          group={groups}
          height={scoresH}
          onResize={setScoresH}
          onClose={() => panels.set('scores', false)}
        />
      )}
      {ctrl && <StatusBar ctrl={ctrl} onAbout={() => setAbout(true)} />}
      {ctrl && <ThemeSync ctrl={ctrl} onDark={setDark} />}
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      {ctrl && menu && (
        <ContextMenu
          ctrl={ctrl}
          menu={menu}
          onClose={() => setMenu(null)}
          onToast={showToast}
          onAddVariant={proposeVariant}
        />
      )}
      {ctrl && hover && panels.tooltip && !menu && <AATooltip ctrl={ctrl} hover={hover} variant={variant} />}
      {/* Floating panels portal their (stable) containers here; the dock rail owns
          the other target. Keeping both mounted lets a panel move between them
          without React remounting its canvas. */}
      <div id="floating-layer" />
      <DockRail />
      </div>
    </MantineProvider>
  )
}
