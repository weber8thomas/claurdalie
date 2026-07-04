import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ActionIcon } from '@mantine/core'
import {
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconMaximize,
  IconMinimize,
  IconPin,
  IconPinnedOff,
  IconX,
} from '@tabler/icons-react'
import { usePanels, type PanelKey, type WindowSeed } from '../panelsStore'

type Corner = 'top-right' | 'top-left' | 'bottom-right'
type ResizeMode = 'both' | 'height' | 'width' | 'none'
type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface FloatingPanelProps {
  panelKey: PanelKey
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  /** Extra header content shown left of the window buttons. */
  controls?: React.ReactNode
  defaultPos?: { x: number; y: number } | Corner
  defaultSize?: { w: number; h: number }
  minSize?: { w: number; h: number }
  maxSize?: { w: number; h: number }
  resize?: ResizeMode
  features?: { fullscreen?: boolean; pin?: boolean; dock?: boolean }
  /** Called after any size / fullscreen / dock change (e.g. to resize a canvas). */
  onGeometryChange?: () => void
  /** Extra class on the panel body wrapper (keeps each panel's bespoke look). */
  bodyClassName?: string
}

const DEFAULT_MIN = { w: 240, h: 180 }
const DEFAULT_MAX = { w: 1400, h: 1000 }

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Resolve a corner keyword (or explicit point) into a viewport top-left. */
function resolveSeed(pos: FloatingPanelProps['defaultPos'], size: { w: number; h: number }): WindowSeed {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
  const m = 16
  if (pos && typeof pos === 'object') return { x: pos.x, y: pos.y, w: size.w, h: size.h }
  switch (pos) {
    case 'top-left':
      return { x: m, y: 52, w: size.w, h: size.h }
    case 'bottom-right':
      return { x: vw - size.w - m, y: 120, w: size.w, h: size.h }
    case 'top-right':
    default:
      return { x: vw - size.w - m, y: 52, w: size.w, h: size.h }
  }
}

/**
 * Shared window chrome for the app's analytical panels: a draggable title bar,
 * edge/corner resize handles, and fullscreen / pin-on-top / dock-to-rail / close
 * buttons. Geometry + flags live in the panelsStore (persisted); each panel just
 * passes its existing body as children. Docked panels render (via portal) into
 * the right-side DockRail slot.
 */
export function FloatingPanel({
  panelKey,
  title,
  onClose,
  children,
  controls,
  defaultPos = 'top-right',
  defaultSize = { w: 380, h: 460 },
  minSize = DEFAULT_MIN,
  maxSize = DEFAULT_MAX,
  resize = 'both',
  features = { fullscreen: true, pin: true, dock: true },
  onGeometryChange,
  bodyClassName,
}: FloatingPanelProps) {
  const win = usePanels((s) => s.windows[panelKey])
  const ensureWindow = usePanels((s) => s.ensureWindow)
  const moveWindow = usePanels((s) => s.moveWindow)
  const resizeWindow = usePanels((s) => s.resizeWindow)
  const bringToFront = usePanels((s) => s.bringToFront)
  const togglePinned = usePanels((s) => s.togglePinned)
  const toggleDocked = usePanels((s) => s.toggleDocked)
  const toggleFullscreen = usePanels((s) => s.toggleFullscreen)

  const seedRef = useRef<WindowSeed | null>(null)
  if (seedRef.current === null) seedRef.current = resolveSeed(defaultPos, defaultSize)
  const geom = win ?? { ...seedRef.current, z: 20, pinned: false, docked: false, fullscreen: false }

  // Seed the store record once on first mount.
  useEffect(() => {
    ensureWindow(panelKey, seedRef.current!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rootRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)
  const pendRef = useRef<{ x: number; y: number } | null>(null)

  // Fire onGeometryChange after size / fullscreen / dock changes (post-layout).
  const onGeo = onGeometryChange
  useEffect(() => {
    if (!onGeo) return
    const id = requestAnimationFrame(onGeo)
    return () => cancelAnimationFrame(id)
  }, [geom.w, geom.h, geom.fullscreen, geom.docked, onGeo])

  const docked = !!(features.dock && geom.docked)
  const fullscreen = !!(features.fullscreen && geom.fullscreen) && !docked
  const effResize: ResizeMode = docked ? 'height' : resize

  // ---- drag (title bar) --------------------------------------------------
  const onHeadPointerDown = (e: React.PointerEvent) => {
    if (fullscreen || docked || e.button !== 0) return
    if ((e.target as HTMLElement).closest('.fp-btn')) return // button, not a drag
    bringToFront(panelKey)
    const sx = e.clientX
    const sy = e.clientY
    const ox = geom.x
    const oy = geom.y
    document.body.classList.add('fp-dragging')
    const move = (ev: PointerEvent) => {
      pendRef.current = { x: ox + (ev.clientX - sx), y: oy + (ev.clientY - sy) }
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0
          const p = pendRef.current
          if (p) moveWindow(panelKey, p.x, p.y)
        })
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      const p = pendRef.current
      if (p) moveWindow(panelKey, p.x, p.y)
      pendRef.current = null
      document.body.classList.remove('fp-dragging')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- resize (edge/corner handles) --------------------------------------
  const startResize = (dir: Dir) => (e: React.PointerEvent) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const sx = e.clientX
    const sy = e.clientY
    const s = { x: geom.x, y: geom.y, w: geom.w, h: geom.h }
    document.body.classList.add('fp-dragging')
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      let w = s.w
      let h = s.h
      let x = s.x
      let y = s.y
      if (dir.includes('e')) w = s.w + dx
      if (dir.includes('s')) h = s.h + dy
      if (dir.includes('w')) w = s.w - dx
      if (dir.includes('n')) h = s.h - dy
      w = clamp(w, minSize.w, maxSize.w)
      h = clamp(h, minSize.h, maxSize.h)
      // Dragging the west/north edges keeps the opposite edge anchored.
      if (dir.includes('w')) x = s.x + (s.w - w)
      if (dir.includes('n')) y = s.y + (s.h - h)
      resizeWindow(panelKey, w, h, docked ? undefined : x, docked ? undefined : y)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('fp-dragging')
      onGeo?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const handles: Dir[] =
    effResize === 'both'
      ? ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
      : effResize === 'height'
        ? ['n', 's']
        : effResize === 'width'
          ? ['e', 'w']
          : []

  const body = (
    <div
      ref={rootRef}
      className={
        'fp' +
        (fullscreen ? ' fullscreen' : '') +
        (docked ? ' docked' : '') +
        (geom.pinned ? ' pinned' : '') +
        (bodyClassName ? ' ' + bodyClassName : '')
      }
      style={
        docked
          ? { height: geom.h }
          : fullscreen
            ? undefined
            : { left: geom.x, top: geom.y, width: geom.w, height: geom.h, zIndex: geom.z }
      }
      onPointerDownCapture={() => !docked && bringToFront(panelKey)}
    >
      <div className="fp-head" onPointerDown={onHeadPointerDown}>
        <span className="panel-title fp-title">{title}</span>
        {controls}
        {features.pin && (
          <ActionIcon
            className="fp-btn"
            variant="subtle"
            color={geom.pinned ? 'teal' : 'gray'}
            size="sm"
            title={geom.pinned ? 'Unpin (allow other panels on top)' : 'Pin on top'}
            onClick={() => togglePinned(panelKey)}
            aria-label="Pin on top"
          >
            {geom.pinned ? <IconPin size={15} /> : <IconPinnedOff size={15} />}
          </ActionIcon>
        )}
        {features.dock && (
          <ActionIcon
            className="fp-btn"
            variant="subtle"
            color={docked ? 'teal' : 'gray'}
            size="sm"
            title={docked ? 'Undock (float)' : 'Dock to side panel'}
            onClick={() => toggleDocked(panelKey)}
            aria-label="Dock to side"
          >
            {docked ? <IconLayoutSidebarRightExpand size={15} /> : <IconLayoutSidebarRightCollapse size={15} />}
          </ActionIcon>
        )}
        {features.fullscreen && !docked && (
          <ActionIcon
            className="fp-btn"
            variant="subtle"
            color="gray"
            size="sm"
            title={fullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={() => toggleFullscreen(panelKey)}
            aria-label="Toggle full screen"
          >
            {fullscreen ? <IconMinimize size={15} /> : <IconMaximize size={15} />}
          </ActionIcon>
        )}
        <ActionIcon className="fp-btn" variant="subtle" color="gray" size="sm" title="Close" onClick={onClose} aria-label="Close">
          <IconX size={15} />
        </ActionIcon>
      </div>

      <div className="fp-body">{children}</div>

      {!fullscreen &&
        handles.map((d) => <div key={d} className={`fp-rz fp-rz-${d}`} onPointerDown={startResize(d)} />)}
    </div>
  )

  if (docked) {
    const slot = typeof document !== 'undefined' ? document.getElementById('dock-rail-slot') : null
    return slot ? createPortal(body, slot) : null
  }
  return body
}
