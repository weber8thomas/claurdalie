import type { EditorController } from './EditorController'
import type { Selection, ScrollbarHit, Hit } from '../render/GridRenderer'

export interface HoverPayload {
  clientX: number
  clientY: number
  row: number
  col: number
}

interface Handlers {
  toggleHelp: () => void
  openContextMenu: (clientX: number, clientY: number, hit: Hit) => void
  onHover: (info: HoverPayload | null) => void
}

/**
 * Attach mouse/wheel and keyboard interaction to the canvas. Returns a cleanup.
 * All actions are imperative on the controller (scroll never goes through React).
 */
export function attachInteraction(
  canvas: HTMLCanvasElement,
  ctrl: EditorController,
  handlers: Handlers,
): () => void {
  const r = ctrl.renderer

  type Drag =
    | { kind: 'none' }
    | { kind: 'select'; anchor: { row: number; col: number } }
    | { kind: 'shift'; ids: number[]; startCol: number; applied: number; key: string }
    | { kind: 'reorder'; from: number; lo: number; hi: number }
    | { kind: 'scroll'; bar: ScrollbarHit; grab: number }
  let drag: Drag = { kind: 'none' }
  let lastHoverKey: string | null = null
  const clearHover = () => {
    if (lastHoverKey !== null) {
      lastHoverKey = null
      handlers.onHover(null)
    }
  }

  const localXY = (e: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId)
    clearHover()
    const { x, y } = localXY(e)

    // Scrollbars take priority (they overlay the grid edges).
    const bar = r.hitScrollbar(x, y)
    if (bar) {
      const pos = bar.axis === 'h' ? x : y
      const onThumb = pos >= bar.thumbStart && pos <= bar.thumbStart + bar.thumbLen
      if (onThumb) {
        drag = { kind: 'scroll', bar, grab: pos - bar.thumbStart }
      } else {
        // Click on the track: jump the thumb centre to the cursor, then drag.
        r.scrollToThumb(bar, pos - bar.thumbLen / 2)
        drag = { kind: 'scroll', bar: r.hitScrollbar(x, y) ?? bar, grab: bar.thumbLen / 2 }
      }
      return
    }

    const hit = r.hitTest(x, y)

    if (hit.region === 'gutter') {
      // Reordering (moving sequences vertically) is an edit — edit mode only.
      if (ctrl.cursorMode && hit.row >= 0 && hit.row < ctrl.store.height) {
        // If the grabbed row is inside a selection, move the whole block.
        const sel = r.selection ? norm(r.selection) : null
        const inSel = sel && hit.row >= sel.r0 && hit.row <= sel.r1
        drag = {
          kind: 'reorder',
          from: hit.row,
          lo: inSel ? sel.r0 : hit.row,
          hi: inSel ? sel.r1 : hit.row,
        }
        r.dropIndex = hit.row
        canvas.style.cursor = 'grabbing'
        r.markDirty()
      }
      return
    }
    if (hit.region !== 'grid') return
    if (hit.row < 0 || hit.row >= ctrl.store.height || hit.col < 0 || hit.col >= ctrl.store.width) return

    if (e.shiftKey && ctrl.cursorMode) {
      // Shift-drag: slide gaps for the row (or selection if it covers the row).
      // Horizontal moving is an edit — edit mode only.
      let ids: number[]
      const sel = r.selection ? norm(r.selection) : null
      if (sel && hit.row >= sel.r0 && hit.row <= sel.r1) {
        ids = []
        for (let v = sel.r0; v <= sel.r1; v++) ids.push(ctrl.store.rowIdAt(v))
      } else {
        ids = [ctrl.store.rowIdAt(hit.row)]
        ctrl.setCursor(hit.row, hit.col)
      }
      drag = { kind: 'shift', ids, startCol: hit.col, applied: 0, key: `drag:${ids.join(',')}:${Date.now()}` }
    } else {
      ctrl.setCursor(hit.row, hit.col)
      drag = { kind: 'select', anchor: { row: hit.row, col: hit.col } }
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    const { x, y } = localXY(e)
    const hit = r.hitTest(x, y)

    if (drag.kind === 'scroll') {
      const pos = drag.bar.axis === 'h' ? x : y
      r.scrollToThumb(drag.bar, pos - drag.grab)
      return
    }

    if (drag.kind === 'none') {
      // Gutter: only draggable (grab + row grip) in edit mode.
      if (hit.region === 'gutter' && hit.row >= 0 && hit.row < ctrl.store.height) {
        if (ctrl.cursorMode) {
          ctrl.setGutterHover(hit.row)
          canvas.style.cursor = 'grab'
        } else {
          ctrl.setGutterHover(null)
          canvas.style.cursor = 'default'
        }
        ctrl.setHover(null)
        clearHover()
        return
      }
      ctrl.setGutterHover(null)
      if (r.hitScrollbar(x, y)) {
        ctrl.setHover(null)
        canvas.style.cursor = 'default'
        clearHover()
        return
      }
      if (hit.region === 'grid' && hit.row < ctrl.store.height && hit.col < ctrl.store.width && hit.row >= 0 && hit.col >= 0) {
        ctrl.setHover({ row: hit.row, col: hit.col })
        canvas.style.cursor = 'cell'
        const key = `${hit.row},${hit.col}`
        if (key !== lastHoverKey) {
          lastHoverKey = key
          handlers.onHover({ clientX: e.clientX, clientY: e.clientY, row: hit.row, col: hit.col })
        }
      } else {
        ctrl.setHover(null)
        canvas.style.cursor = 'default'
        clearHover()
      }
      return
    }

    if (drag.kind === 'select') {
      const row = clamp(hit.row, 0, ctrl.store.height - 1)
      const col = clamp(hit.col, 0, ctrl.store.width - 1)
      ctrl.setSelection({ r0: drag.anchor.row, c0: drag.anchor.col, r1: row, c1: col })
      ctrl.setCursor(row, col, true)
      autoScroll(x, y)
    } else if (drag.kind === 'shift') {
      const want = clamp(hit.col, 0, ctrl.store.width) - drag.startCol
      const diff = want - drag.applied
      if (diff !== 0) {
        ctrl.shiftRowsById(drag.ids, diff, drag.key)
        drag.applied = want
      }
    } else if (drag.kind === 'reorder') {
      r.dropIndex = r.dropIndexAt(y)
      r.markDirty()
    }
  }

  const onPointerUp = (e: PointerEvent) => {
    if (drag.kind === 'reorder') {
      const to = r.dropIndex ?? drag.from
      r.dropIndex = null
      canvas.style.cursor = 'grab'
      if (drag.lo === drag.hi) ctrl.reorder(drag.from, to)
      else ctrl.moveRows(drag.lo, drag.hi, to)
    }
    if (drag.kind === 'select' && e) {
      // A pure click (no movement) leaves just the cursor, no selection box.
      const sel = r.selection ? norm(r.selection) : null
      if (sel && sel.r0 === sel.r1 && sel.c0 === sel.c1) ctrl.setSelection(null)
    }
    drag = { kind: 'none' }
  }

  const onPointerLeave = () => {
    if (drag.kind === 'none') {
      ctrl.setHover(null)
      ctrl.setGutterHover(null)
      clearHover()
    }
  }

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const { x, y } = localXY(e)
      r.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, x, y)
      ctrl.snapshotBump()
      return
    }
    const unit = e.deltaMode === 1 ? r.cellH : 1
    // Shift+wheel scrolls horizontally (standard for vertical-only mice).
    if (e.shiftKey && e.deltaX === 0) {
      r.scrollBy(e.deltaY * unit, 0)
    } else {
      r.scrollBy(e.deltaX * unit, e.deltaY * unit)
    }
  }

  let scrollTimer = 0
  const autoScroll = (x: number, y: number) => {
    // Edge auto-scroll while drag-selecting near borders.
    const edge = 24
    let dx = 0
    let dy = 0
    if (x > canvas.clientWidth - edge) dx = 12
    else if (x < 156 + edge) dx = -12
    if (y > canvas.clientHeight - edge) dy = 12
    else if (y < 22 + edge) dy = -12
    if (dx || dy) r.scrollBy(dx, dy)
    void scrollTimer
  }

  // ---- keyboard -----------------------------------------------------------

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    const mod = e.metaKey || e.ctrlKey

    // History
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) ctrl.redoAction()
      else ctrl.undoAction()
      return
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      ctrl.redoAction()
      return
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      ctrl.selectAll()
      return
    }

    // Sequence shift with Ctrl/Cmd + arrows (edit mode only)
    if (mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault() // also stops browser history navigation
      if (ctrl.cursorMode) ctrl.shiftTargets(e.key === 'ArrowRight' ? 1 : -1)
      return
    }

    // Gap editing via keyboard only applies in cursor/edit mode.
    if ((e.key === ' ' || e.key === 'Delete' || e.key === 'Backspace') && !ctrl.cursorMode) return

    switch (e.key) {
      case 'F2':
        e.preventDefault()
        ctrl.toggleCursorMode()
        return
      case ' ':
        e.preventDefault()
        ctrl.insertGap() // advances the cursor itself; keeps any selection intact
        return
      case 'Delete':
        e.preventDefault()
        ctrl.deleteGap()
        return
      case 'Backspace':
        e.preventDefault()
        ctrl.deleteGapLeft()
        return
      case 'ArrowLeft':
        e.preventDefault()
        ctrl.cursorMode ? ctrl.moveCursor(0, -1, e.shiftKey) : r.scrollBy(-r.cellW * 3, 0)
        return
      case 'ArrowRight':
        e.preventDefault()
        ctrl.cursorMode ? ctrl.moveCursor(0, 1, e.shiftKey) : r.scrollBy(r.cellW * 3, 0)
        return
      case 'ArrowUp':
        e.preventDefault()
        ctrl.cursorMode ? ctrl.moveCursor(-1, 0, e.shiftKey) : r.scrollBy(0, -r.cellH * 3)
        return
      case 'ArrowDown':
        e.preventDefault()
        ctrl.cursorMode ? ctrl.moveCursor(1, 0, e.shiftKey) : r.scrollBy(0, r.cellH * 3)
        return
      case 'Home':
        e.preventDefault()
        ctrl.cursorMode ? ctrl.setCursor(ctrl.renderer.cursor?.row ?? 0, 0, e.shiftKey) : r.setScroll(0, r.scrollY)
        return
      case 'End':
        e.preventDefault()
        ctrl.cursorMode
          ? ctrl.setCursor(ctrl.renderer.cursor?.row ?? 0, ctrl.store.width - 1, e.shiftKey)
          : r.setScroll(r.maxScroll().x, r.scrollY)
        return
      case 'PageUp':
        e.preventDefault()
        ctrl.scrollPage(-1)
        return
      case 'PageDown':
        e.preventDefault()
        ctrl.scrollPage(1)
        return
      case 'Escape':
        e.preventDefault()
        if (ctrl.renderer.selection) ctrl.clearSelection()
        else if (ctrl.cursorMode) ctrl.toggleCursorMode()
        return
      case '+':
      case '=':
        e.preventDefault()
        ctrl.zoomBy(1.15)
        return
      case '-':
      case '_':
        e.preventDefault()
        ctrl.zoomBy(1 / 1.15)
        return
      case '0':
        e.preventDefault()
        ctrl.resetZoom()
        return
      case '?':
      case '/':
        if (e.key === '/' && !e.shiftKey) break
        e.preventDefault()
        handlers.toggleHelp()
        return
    }
  }

  const onContextMenu = (e: MouseEvent) => {
    const { x, y } = localXY(e as unknown as WheelEvent)
    const hit = r.hitTest(x, y)
    if (hit.region === 'grid' || hit.region === 'gutter') {
      e.preventDefault()
      handlers.openContextMenu(e.clientX, e.clientY, hit)
    }
  }

  canvas.addEventListener('contextmenu', onContextMenu)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onKeyDown)

  return () => {
    canvas.removeEventListener('contextmenu', onContextMenu)
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    canvas.removeEventListener('wheel', onWheel)
    window.removeEventListener('keydown', onKeyDown)
  }
}

function norm(s: Selection): Selection {
  return {
    r0: Math.min(s.r0, s.r1),
    r1: Math.max(s.r0, s.r1),
    c0: Math.min(s.c0, s.c1),
    c1: Math.max(s.c0, s.c1),
  }
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
