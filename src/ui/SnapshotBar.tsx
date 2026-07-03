import { useRef, useSyncExternalStore } from 'react'
import type { ProjectStore } from '../project/ProjectStore'

interface Props {
  project: ProjectStore
  onToast?: (msg: string) => void
}

/**
 * Ordalie's Snapshot Bar: a combobox to juggle between analytical instances,
 * plus New / Overwrite / Rename / Delete, and Export/Import of the whole project
 * as a .clproj file. Switching restores the exact state of the alignment and
 * every registered sub-module (see ProjectStore).
 */
export function SnapshotBar({ project, onToast }: Props) {
  const key = useSyncExternalStore(
    (fn) => project.subscribe(fn),
    () => project.listKey(),
  )
  const list = project.list()
  const active = list.find((i) => i.active)
  const fileRef = useRef<HTMLInputElement>(null)

  const onExport = async () => {
    try {
      const bytes = await project.toFile()
      const blob = new Blob([bytes as BlobPart], { type: 'application/gzip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'project.clproj'
      a.click()
      URL.revokeObjectURL(url)
      onToast?.('Exported project.clproj')
    } catch {
      onToast?.('Export failed')
    }
  }
  const onImport = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await project.fromFile(bytes)
      onToast?.(`Imported ${file.name}`)
    } catch {
      onToast?.('Import failed — not a valid .clproj file')
    }
  }

  return (
    <div className="snapshot-bar" data-rev={key}>
      <span className="snapshot-label">Instance</span>
      <select
        className="snapshot-select"
        value={active?.id ?? ''}
        onChange={(e) => project.switchTo(Number(e.target.value))}
        title="Switch analytical instance (state is preserved)"
      >
        {list.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name} · {i.sequences}×{i.columns}
          </option>
        ))}
      </select>
      <button
        className="snapshot-btn"
        title="New instance (fork the current state)"
        onClick={() => {
          project.newSnapshot()
          onToast?.('Forked a new instance')
        }}
      >
        + New
      </button>
      <button
        className="snapshot-btn"
        title="Overwrite this instance with the current state"
        onClick={() => {
          project.overwrite()
          onToast?.('Instance saved')
        }}
      >
        Overwrite
      </button>
      <button
        className="snapshot-btn"
        title="Rename this instance"
        onClick={() => {
          if (!active) return
          const name = window.prompt('Rename instance', active.name)
          if (name) project.rename(active.id, name.trim() || active.name)
        }}
      >
        Rename
      </button>
      <button
        className="snapshot-btn danger"
        title="Delete this instance"
        disabled={list.length <= 1}
        onClick={() => {
          if (active && window.confirm(`Delete instance "${active.name}"?`)) project.remove(active.id)
        }}
      >
        Delete
      </button>

      <div className="snapshot-spacer" />
      <button className="snapshot-btn" title="Export the whole project (.clproj)" onClick={() => void onExport()}>
        Export
      </button>
      <button
        className="snapshot-btn"
        title="Import a project (.clproj)"
        onClick={() => fileRef.current?.click()}
      >
        Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".clproj"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onImport(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
