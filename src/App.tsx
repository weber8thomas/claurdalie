import { useCallback, useRef, useState } from 'react'
import type { EditorController } from './editor/EditorController'
import { AlignmentCanvas } from './ui/AlignmentCanvas'
import { Toolbar } from './ui/Toolbar'
import { StatusBar } from './ui/StatusBar'
import { Minimap } from './ui/Minimap'
import { SchemeLegend } from './ui/SchemeLegend'
import { HelpOverlay } from './ui/HelpOverlay'
import { ThemeSync } from './ui/ThemeSync'

export default function App() {
  const [ctrl, setCtrl] = useState<EditorController | null>(null)
  const [help, setHelp] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const toastTimer = useRef(0)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2400)
  }, [])

  const toggleHelp = useCallback(() => setHelp((h) => !h), [])

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
      {ctrl && <Toolbar ctrl={ctrl} onToast={showToast} onToggleHelp={toggleHelp} />}
      <div className="main">
        <AlignmentCanvas onReady={setCtrl} onToggleHelp={toggleHelp} />
        {ctrl && <SchemeLegend ctrl={ctrl} />}
        {ctrl && <Minimap ctrl={ctrl} />}
        {dragging && <div className="dropzone">Drop a FASTA file to load</div>}
      </div>
      {ctrl && <StatusBar ctrl={ctrl} />}
      {ctrl && <ThemeSync ctrl={ctrl} />}
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
