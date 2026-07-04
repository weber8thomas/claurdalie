import { useRef, useSyncExternalStore } from 'react'
import { ActionIcon, Button, Group, Menu, Select, Text, Tooltip } from '@mantine/core'
import {
  IconAlignLeft,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBarcode,
  IconBinaryTree,
  IconCheck,
  IconChevronDown,
  IconChartHistogram,
  IconCopy,
  IconCube,
  IconDeviceFloppy,
  IconEye,
  IconFileExport,
  IconFileImport,
  IconFlask,
  IconFolder,
  IconHelp,
  IconHelpCircle,
  IconInfoCircle,
  IconMap,
  IconMapPin,
  IconMaximize,
  IconMessage,
  IconMicroscope,
  IconMinus,
  IconMoon,
  IconPalette,
  IconPencil,
  IconPlus,
  IconRowInsertBottom,
  IconRowRemove,
  IconSearch,
  IconSun,
  IconTable,
  IconTrash,
  IconUsersGroup,
} from '@tabler/icons-react'
import type { EditorController } from '../editor/EditorController'
import type { ProjectStore } from '../project/ProjectStore'
import { useEditorSnapshot } from './useEditor'
import { usePanels, type PanelKey } from './panelsStore'
import { BrandMark } from './BrandMark'
import { GLOBINS_FASTA } from '../datasets/globins'
import { KINASE_FASTA } from '../datasets/kinase'
import { REPO_URL } from '../version'

interface Props {
  ctrl: EditorController
  project: ProjectStore | null
  onToast: (msg: string) => void
  onToggleHelp: () => void
  onAbout: () => void
}

const SCHEMES = [
  { id: 'clustal', label: 'ClustalX (dynamic)' },
  { id: 'zappo', label: 'Zappo' },
  { id: 'taylor', label: 'Taylor' },
  { id: 'hydro', label: 'Hydrophobicity' },
  { id: 'plain', label: 'Plain' },
]

const ICON = 16

/** A menu item that toggles a boolean and shows a check when it is on. */
function CheckItem({
  icon,
  label,
  checked,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  checked: boolean
  onClick: () => void
}) {
  return (
    <Menu.Item
      leftSection={icon}
      rightSection={checked ? <IconCheck size={14} /> : null}
      onClick={onClick}
      data-active={checked || undefined}
    >
      {label}
    </Menu.Item>
  )
}

/** The menu-bar trigger: a subtle pill with a section icon, label and chevron. */
function MenuButton({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <Button
      className="menu-trigger"
      variant="subtle"
      color="gray"
      size="xs"
      leftSection={icon}
      rightSection={<IconChevronDown size={13} />}
    >
      {label}
    </Button>
  )
}

export function Toolbar({ ctrl, project, onToast, onToggleHelp, onAbout }: Props) {
  const snap = useEditorSnapshot(ctrl)
  const panels = usePanels()
  const fileRef = useRef<HTMLInputElement>(null)
  const projRef = useRef<HTMLInputElement>(null)
  // Which scope the pending .clproj import dialog is for.
  const importMode = useRef<'instance' | 'project'>('project')

  // Subscribe to the project so the instance Select reflects forks/switches.
  const projKey = useSyncExternalStore(
    (fn) => (project ? project.subscribe(fn) : () => {}),
    () => (project ? project.listKey() : ''),
  )
  const instances = project ? project.list() : []
  const activeInstance = instances.find((i) => i.active)

  const toggle = (k: PanelKey) => panels.toggle(k)

  const onImportFasta = async (file: File) => {
    ctrl.loadFasta(await file.text())
    onToast(`Imported ${file.name} — ${ctrl.store.height} sequences`)
  }
  const onExportFasta = () => {
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
    } else if (kind === 'globins') {
      ctrl.loadFasta(GLOBINS_FASTA)
      onToast('Loaded globins: myoglobin + hemoglobin α/β (12 seqs)')
    } else if (kind === 'kinase') {
      ctrl.loadFasta(KINASE_FASTA)
      onToast('Loaded kinase cores (12 seqs) — try Motif search “DFG” or “HRD”')
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

  // ---- Session (.clproj) operations, folded in from the old SnapshotBar ----
  // A session exports/imports at two scopes: the active instance, or the whole
  // project (all instances). Import either adds a new instance or replaces all.
  const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'instance'
  const download = (bytes: Uint8Array, name: string) => {
    const blob = new Blob([bytes as BlobPart], { type: 'application/gzip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }
  const exportSession = async (scope: 'instance' | 'project') => {
    if (!project) return
    try {
      if (scope === 'instance') {
        download(await project.toFileActive(), `${safeName(activeInstance?.name ?? 'instance')}.clproj`)
        onToast(`Exported instance "${activeInstance?.name ?? ''}"`)
      } else {
        download(await project.toFile(), 'project.clproj')
        onToast('Exported project.clproj')
      }
    } catch {
      onToast('Export failed')
    }
  }
  const importSession = async (file: File) => {
    if (!project) return
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (importMode.current === 'instance') {
        await project.addInstancesFromFile(bytes)
        onToast(`Imported ${file.name} as new instance`)
      } else {
        await project.fromFile(bytes)
        onToast(`Imported ${file.name}`)
      }
    } catch {
      onToast('Import failed — not a valid .clproj file')
    }
  }
  const renameInstance = () => {
    if (!project || !activeInstance) return
    const name = window.prompt('Rename instance', activeInstance.name)
    if (name) project.rename(activeInstance.id, name.trim() || activeInstance.name)
  }
  const deleteInstance = () => {
    if (!project || !activeInstance) return
    if (window.confirm(`Delete instance "${activeInstance.name}"?`)) project.remove(activeInstance.id)
  }

  // ---- Editing actions (operate on the current cursor / selection) ----
  const canEdit = snap.cursorMode
  const cursorRow = snap.cursor?.row ?? -1
  const copy = async (text: string | null, what: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      onToast(`Copied ${what}`)
    } catch {
      onToast('Clipboard unavailable')
    }
  }
  const removeGapCols = () => {
    const n = ctrl.removeGapOnlyColumns()
    onToast(n ? `Removed ${n} gap-only column${n > 1 ? 's' : ''}` : 'No gap-only columns')
  }

  const zoomPct = Math.round((snap.cellW / 16) * 100)

  return (
    <div className="toolbar" data-rev={projKey}>
      <a
        className="brand"
        href={REPO_URL}
        target="_blank"
        rel="noreferrer noopener"
        title="View Claurdalie on GitHub"
      >
        <BrandMark />
        Claurdalie
      </a>

      <Group gap={2} wrap="nowrap" className="menubar">
        {/* ---------------- File ---------------- */}
        <Menu>
          <Menu.Target>
            <div>
              <MenuButton label="File" icon={<IconFolder size={ICON} />} />
            </div>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconFileImport size={ICON} />} onClick={() => fileRef.current?.click()}>
              Import FASTA…
            </Menu.Item>
            <Menu.Item leftSection={<IconFileExport size={ICON} />} onClick={onExportFasta}>
              Export FASTA
            </Menu.Item>
            <Menu.Divider />
            <Menu.Label>Examples</Menu.Label>
            <Menu.Item leftSection={<IconFlask size={ICON} />} onClick={() => loadExample('light')}>
              Demo · cytochrome c
            </Menu.Item>
            <Menu.Item leftSection={<IconFlask size={ICON} />} onClick={() => loadExample('globins')}>
              Globins · Mb + Hb α/β
            </Menu.Item>
            <Menu.Item leftSection={<IconFlask size={ICON} />} onClick={() => loadExample('kinase')}>
              Kinases · motif demo
            </Menu.Item>
            <Menu.Item leftSection={<IconFlask size={ICON} />} onClick={() => loadExample('heavy')}>
              Heavy · 3k × 10k
            </Menu.Item>
            <Menu.Item leftSection={<IconFlask size={ICON} />} onClick={() => loadExample('huge')}>
              Huge · 10k × 30k
            </Menu.Item>
            <Menu.Divider />
            <Menu.Label>Project</Menu.Label>
            <Menu.Sub>
              <Menu.Sub.Target>
                <Menu.Sub.Item leftSection={<IconDeviceFloppy size={ICON} />}>Instance</Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <Menu.Item
                  leftSection={<IconPlus size={ICON} />}
                  onClick={() => {
                    project?.newSnapshot()
                    onToast('Forked a new instance')
                  }}
                >
                  New instance
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconDeviceFloppy size={ICON} />}
                  onClick={() => {
                    project?.overwrite()
                    onToast('Instance saved')
                  }}
                >
                  Overwrite
                </Menu.Item>
                <Menu.Item leftSection={<IconPencil size={ICON} />} onClick={renameInstance}>
                  Rename…
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconTrash size={ICON} />}
                  color="red"
                  disabled={instances.length <= 1}
                  onClick={deleteInstance}
                >
                  Delete
                </Menu.Item>
              </Menu.Sub.Dropdown>
            </Menu.Sub>
            <Menu.Sub>
              <Menu.Sub.Target>
                <Menu.Sub.Item leftSection={<IconFileExport size={ICON} />}>Export session (.clproj)</Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <Menu.Item leftSection={<IconDeviceFloppy size={ICON} />} onClick={() => void exportSession('instance')}>
                  This instance
                </Menu.Item>
                <Menu.Item leftSection={<IconFileExport size={ICON} />} onClick={() => void exportSession('project')}>
                  Whole project
                </Menu.Item>
              </Menu.Sub.Dropdown>
            </Menu.Sub>
            <Menu.Sub>
              <Menu.Sub.Target>
                <Menu.Sub.Item leftSection={<IconFileImport size={ICON} />}>Import session (.clproj)</Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <Menu.Item
                  leftSection={<IconPlus size={ICON} />}
                  onClick={() => {
                    importMode.current = 'instance'
                    projRef.current?.click()
                  }}
                >
                  As new instance
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconFileImport size={ICON} />}
                  onClick={() => {
                    importMode.current = 'project'
                    projRef.current?.click()
                  }}
                >
                  Replace project
                </Menu.Item>
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          </Menu.Dropdown>
        </Menu>

        {/* ---------------- Edit ---------------- */}
        <Menu>
          <Menu.Target>
            <div>
              <MenuButton label="Edit" icon={<IconPencil size={ICON} />} />
            </div>
          </Menu.Target>
          <Menu.Dropdown>
            <CheckItem
              icon={<IconPencil size={ICON} />}
              label="Edit mode (F2)"
              checked={snap.cursorMode}
              onClick={() => ctrl.toggleCursorMode()}
            />
            <Menu.Item
              leftSection={<IconArrowBackUp size={ICON} />}
              disabled={!snap.canUndo}
              onClick={() => ctrl.undoAction()}
            >
              Undo <Text span c="dimmed" fz="xs">⌘Z</Text>
            </Menu.Item>
            <Menu.Item
              leftSection={<IconArrowForwardUp size={ICON} />}
              disabled={!snap.canRedo}
              onClick={() => ctrl.redoAction()}
            >
              Redo <Text span c="dimmed" fz="xs">⌘⇧Z</Text>
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item leftSection={<IconRowInsertBottom size={ICON} />} disabled={!canEdit} onClick={() => ctrl.insertGap()}>
              Insert gap
            </Menu.Item>
            <Menu.Item leftSection={<IconRowRemove size={ICON} />} disabled={!canEdit} onClick={() => ctrl.deleteGap()}>
              Delete gap
            </Menu.Item>
            <Menu.Item leftSection={<IconArrowBackUp size={ICON} />} disabled={!canEdit} onClick={() => ctrl.shiftTargets(-1)}>
              Shift left <Text span c="dimmed" fz="xs">⌘←</Text>
            </Menu.Item>
            <Menu.Item leftSection={<IconArrowForwardUp size={ICON} />} disabled={!canEdit} onClick={() => ctrl.shiftTargets(1)}>
              Shift right <Text span c="dimmed" fz="xs">⌘→</Text>
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item leftSection={<IconRowRemove size={ICON} />} disabled={!canEdit} onClick={removeGapCols}>
              Remove gap-only columns
            </Menu.Item>
            <Menu.Item
              leftSection={<IconCopy size={ICON} />}
              disabled={cursorRow < 0}
              onClick={() => void copy(ctrl.rowFasta(cursorRow), 'sequence')}
            >
              Copy sequence (FASTA)
            </Menu.Item>
            <Menu.Item
              leftSection={<IconCopy size={ICON} />}
              disabled={!snap.selection}
              onClick={() => void copy(ctrl.selectionFasta(), 'selection')}
            >
              Copy selection (FASTA)
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>

        {/* ---------------- View ---------------- */}
        <Menu closeOnItemClick={false}>
          <Menu.Target>
            <div>
              <MenuButton label="View" icon={<IconEye size={ICON} />} />
            </div>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Color scheme</Menu.Label>
            {SCHEMES.map((s) => (
              <CheckItem
                key={s.id}
                icon={<IconPalette size={ICON} />}
                label={s.label}
                checked={snap.schemeId === s.id}
                onClick={() => ctrl.setSchemeId(s.id)}
              />
            ))}
            <Menu.Divider />
            <CheckItem icon={<IconPalette size={ICON} />} label="Legend" checked={panels.legend} onClick={() => toggle('legend')} />
            <CheckItem icon={<IconMap size={ICON} />} label="Minimap" checked={panels.minimap} onClick={() => toggle('minimap')} />
            <CheckItem icon={<IconMessage size={ICON} />} label="Residue tooltip" checked={panels.tooltip} onClick={() => panels.setTooltip(!panels.tooltip)} />
            <Menu.Divider />
            <CheckItem
              icon={snap.dark ? <IconSun size={ICON} /> : <IconMoon size={ICON} />}
              label={snap.dark ? 'Light theme' : 'Dark theme'}
              checked={snap.dark}
              onClick={() => ctrl.setDark(!snap.dark)}
            />
          </Menu.Dropdown>
        </Menu>

        {/* ---------------- Analysis ---------------- */}
        <Menu closeOnItemClick={false}>
          <Menu.Target>
            <div>
              <MenuButton label="Analysis" icon={<IconMicroscope size={ICON} />} />
            </div>
          </Menu.Target>
          <Menu.Dropdown>
            <CheckItem icon={<IconChartHistogram size={ICON} />} label="Conservation scores" checked={panels.scores} onClick={() => toggle('scores')} />
            <CheckItem icon={<IconUsersGroup size={ICON} />} label="Clustering & groups" checked={panels.cluster} onClick={() => toggle('cluster')} />
            <CheckItem icon={<IconBarcode size={ICON} />} label="Barcode" checked={panels.barcode} onClick={() => toggle('barcode')} />
            <CheckItem icon={<IconBinaryTree size={ICON} />} label="Phylogenetic tree" checked={panels.tree} onClick={() => toggle('tree')} />
            <CheckItem icon={<IconTable size={ICON} />} label="Sequence identity" checked={panels.identity} onClick={() => toggle('identity')} />
            <CheckItem icon={<IconSearch size={ICON} />} label="Motif search" checked={panels.motif} onClick={() => toggle('motif')} />
            <CheckItem icon={<IconMapPin size={ICON} />} label="Variant / mutation-effect" checked={panels.variant} onClick={() => toggle('variant')} />
            <Menu.Divider />
            <CheckItem icon={<IconAlignLeft size={ICON} />} label="Re-align sequences" checked={panels.align} onClick={() => toggle('align')} />
          </Menu.Dropdown>
        </Menu>

        {/* ---------------- Structure ---------------- */}
        <Menu closeOnItemClick={false}>
          <Menu.Target>
            <div>
              <MenuButton label="Structure" icon={<IconCube size={ICON} />} />
            </div>
          </Menu.Target>
          <Menu.Dropdown>
            <CheckItem icon={<IconCube size={ICON} />} label="3D structure panel" checked={panels.structure} onClick={() => toggle('structure')} />
          </Menu.Dropdown>
        </Menu>

        {/* ---------------- Help ---------------- */}
        <Menu>
          <Menu.Target>
            <div>
              <MenuButton label="Help" icon={<IconHelpCircle size={ICON} />} />
            </div>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconHelp size={ICON} />} onClick={onToggleHelp}>
              Keyboard shortcuts <Text span c="dimmed" fz="xs">?</Text>
            </Menu.Item>
            <Menu.Item leftSection={<IconInfoCircle size={ICON} />} onClick={onAbout}>
              About Claurdalie
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      <div className="spacer" />

      {/* High-frequency controls stay always-visible on the right. */}
      <Group gap={4} wrap="nowrap">
        <ActionIcon.Group>
          <Tooltip label="Zoom out (−)">
            <ActionIcon variant="default" onClick={() => ctrl.zoomBy(1 / 1.15)} aria-label="Zoom out">
              <IconMinus size={ICON} />
            </ActionIcon>
          </Tooltip>
          <Button variant="default" size="xs" px={8} onClick={() => ctrl.resetZoom()} title="Reset zoom (0)">
            {zoomPct}%
          </Button>
          <Tooltip label="Zoom in (+)">
            <ActionIcon variant="default" onClick={() => ctrl.zoomBy(1.15)} aria-label="Zoom in">
              <IconPlus size={ICON} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Reset zoom (0)">
            <ActionIcon variant="default" onClick={() => ctrl.resetZoom()} aria-label="Reset zoom">
              <IconMaximize size={ICON} />
            </ActionIcon>
          </Tooltip>
        </ActionIcon.Group>

        <ActionIcon.Group>
          <Tooltip label="Toggle edit mode (F2)">
            <ActionIcon
              variant={snap.cursorMode ? 'filled' : 'default'}
              onClick={() => ctrl.toggleCursorMode()}
              aria-label="Edit mode"
            >
              <IconPencil size={ICON} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Undo (⌘Z)">
            <ActionIcon variant="default" disabled={!snap.canUndo} onClick={() => ctrl.undoAction()} aria-label="Undo">
              <IconArrowBackUp size={ICON} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Redo (⌘⇧Z)">
            <ActionIcon variant="default" disabled={!snap.canRedo} onClick={() => ctrl.redoAction()} aria-label="Redo">
              <IconArrowForwardUp size={ICON} />
            </ActionIcon>
          </Tooltip>
        </ActionIcon.Group>

        {project && instances.length > 0 && (
          <div className="session-field">
            <Text className="session-label" component="span">
              Session
            </Text>
            <Tooltip label="Switch session (analytical instance — state is preserved)">
              <Select
                className="instance-select"
                size="xs"
                w={188}
                data={instances.map((i) => ({ value: String(i.id), label: `${i.name} · ${i.sequences}×${i.columns}` }))}
                value={activeInstance ? String(activeInstance.id) : null}
                onChange={(v) => v && project.switchTo(Number(v))}
                allowDeselect={false}
                comboboxProps={{ width: 260, position: 'bottom-end' }}
              />
            </Tooltip>
          </div>
        )}
      </Group>

      <input
        ref={fileRef}
        type="file"
        accept=".fasta,.fa,.faa,.txt,.aln"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onImportFasta(f)
          e.target.value = ''
        }}
      />
      <input
        ref={projRef}
        type="file"
        accept=".clproj"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void importSession(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
