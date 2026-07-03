import { useRef, useSyncExternalStore } from 'react'
import type { ProjectStore } from '../project/ProjectStore'

interface Props {
  project: ProjectStore
  onToast?: (msg: string) => void
}

/**
 * Ordalie's Snapshot Bar: a combobox to juggle between analytical instances,
 * plus New / Overwrite / Rename / Delete, and Session export/import as a .clproj
 * file at two scopes — a single instance or the whole project. Switching (and
 * importing) restores the exact state of the alignment and every registered
 * sub-module (see ProjectStore). A "session" here is the alignment + its
 * metadata; annotations will ride the same per-snapshot slices later.
 */
export function SnapshotBar({ project, onToast }: Props) {
  const key = useSyncExternalStore(
    (fn) => project.subscribe(fn),
    () => project.listKey(),
  )
  const list = project.list()
  const active = list.find((i) => i.active)
  const fileRef = useRef<HTMLInputElement>(null)
  // Which import scope the pending file dialog is for (see the file input below).
  const importMode = useRef<'instance' | 'project'>('project')

  const download = (bytes: Uint8Array, name: string) => {
    const blob = new Blob([bytes as BlobPart], { type: 'application/gzip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }
  // Filesystem-safe filename from an instance name (fallback to a default).
  const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'instance'

  const onExport = async (scope: 'instance' | 'project') => {
    try {
      if (scope === 'instance') {
        download(await project.toFileActive(), `${safeName(active?.name ?? 'instance')}.clproj`)
        onToast?.(`Exported instance "${active?.name ?? ''}"`)
      } else {
        download(await project.toFile(), 'project.clproj')
        onToast?.('Exported project.clproj')
      }
    } catch {
      onToast?.('Export failed')
    }
  }
  const onImport = async (file: File) => {
    const mode = importMode.current
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (mode === 'instance') {
        await project.addInstancesFromFile(bytes)
        onToast?.(`Imported ${file.name} as new instance`)
      } else {
        await project.fromFile(bytes)
        onToast?.(`Imported ${file.name}`)
      }
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
      <span className="snapshot-label">Session</span>
      <select
        className="snapshot-select"
        value=""
        title="Export a session (.clproj) — this instance, or the whole project"
        onChange={(e) => {
          const scope = e.target.value as 'instance' | 'project'
          e.target.value = ''
          if (scope) void onExport(scope)
        }}
      >
        <option value="">Export…</option>
        <option value="instance">This instance</option>
        <option value="project">Whole project</option>
      </select>
      <select
        className="snapshot-select"
        value=""
        title="Import a session (.clproj) — add as a new instance, or replace the project"
        onChange={(e) => {
          const mode = e.target.value as 'instance' | 'project'
          e.target.value = ''
          if (!mode) return
          importMode.current = mode
          fileRef.current?.click()
        }}
      >
        <option value="">Import…</option>
        <option value="instance">As new instance</option>
        <option value="project">Replace project</option>
      </select>
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
