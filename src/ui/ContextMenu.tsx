import { useEffect, useRef } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { Hit } from '../render/GridRenderer'

export interface MenuState {
  x: number
  y: number
  hit: Hit
}

interface Item {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

export function ContextMenu({
  ctrl,
  menu,
  onClose,
  onToast,
}: {
  ctrl: EditorController
  menu: MenuState
  onClose: () => void
  onToast: (msg: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { hit } = menu
  const v = hit.row
  const inGrid = hit.region === 'grid'
  const hasSelection = !!ctrl.renderer.selection
  const targetIsSelection = hasSelection && ctrl.isInSelection(hit.row, hit.col)

  // Focus the target: if not right-clicking inside a selection, place the cursor
  // on the clicked cell so edit actions operate there.
  const focusTarget = () => {
    if (inGrid && !targetIsSelection) ctrl.setCursor(hit.row, hit.col)
  }

  const copy = async (text: string | null, what: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      onToast(`Copied ${what}`)
    } catch {
      onToast('Clipboard unavailable')
    }
  }

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  const canEdit = ctrl.cursorMode // editing (moving) is only allowed in edit mode
  const items: (Item | 'sep')[] = []
  if (!canEdit) {
    items.push(
      { label: 'Enable Edit mode (F2) to modify', onClick: run(() => ctrl.toggleCursorMode()) },
      'sep',
    )
  }
  if (inGrid) {
    const scope = targetIsSelection ? 'selection' : 'cell'
    items.push(
      { label: `Insert gap (${scope})`, disabled: !canEdit, onClick: run(() => { focusTarget(); ctrl.insertGap() }) },
      { label: `Delete gap (${scope})`, disabled: !canEdit, onClick: run(() => { focusTarget(); ctrl.deleteGap() }) },
      'sep',
      { label: 'Shift sequence left  ⌘←', disabled: !canEdit, onClick: run(() => { focusTarget(); ctrl.shiftTargets(-1) }) },
      { label: 'Shift sequence right ⌘→', disabled: !canEdit, onClick: run(() => { focusTarget(); ctrl.shiftTargets(1) }) },
      'sep',
    )
  }
  items.push(
    { label: 'Move sequence up', disabled: !canEdit || v <= 0, onClick: run(() => ctrl.moveRowBy(v, -1)) },
    { label: 'Move sequence down', disabled: !canEdit || v >= ctrl.store.height - 1, onClick: run(() => ctrl.moveRowBy(v, 1)) },
    'sep',
    { label: 'Copy sequence (FASTA)', onClick: run(() => void copy(ctrl.rowFasta(v), 'sequence')) },
  )
  if (hasSelection) {
    items.push({ label: 'Copy selection (FASTA)', onClick: run(() => void copy(ctrl.selectionFasta(), 'selection')) })
  }
  items.push(
    'sep',
    {
      label: 'Remove gap-only columns',
      disabled: !canEdit,
      onClick: run(() => {
        const n = ctrl.removeGapOnlyColumns()
        onToast(n ? `Removed ${n} gap-only column${n > 1 ? 's' : ''}` : 'No gap-only columns')
      }),
    },
  )

  // Opening the menu on a name highlights that whole track.
  useEffect(() => {
    if (hit.region === 'gutter') ctrl.selectRow(hit.row)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close on outside click / Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Keep the menu within the viewport.
  const style: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 240),
    top: Math.min(menu.y, window.innerHeight - items.length * 30 - 12),
  }

  return (
    <div className="ctx-menu" ref={ref} style={style} role="menu">
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            className={'ctx-item' + (it.danger ? ' danger' : '')}
            disabled={it.disabled}
            onClick={it.onClick}
            role="menuitem"
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  )
}
