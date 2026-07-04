import { ActionIcon, Text } from '@mantine/core'
import { IconLayoutSidebar, IconLayoutSidebarRightExpand } from '@tabler/icons-react'
import { usePanels } from '../panelsStore'

/**
 * The right-side dock rail ("Panels"): a collapsible, width-resizable column that
 * hosts panels the user has docked. It always renders the `#dock-rail-slot` portal
 * target so a FloatingPanel can portal into it the moment it is docked; the rail
 * chrome shows only when at least one panel is docked. Collapsed, it shrinks to a
 * thin labeled "Panels" column with an icon.
 */
export function DockRail() {
  const windows = usePanels((s) => s.windows)
  const collapsed = usePanels((s) => s.railCollapsed)
  const setCollapsed = usePanels((s) => s.setRailCollapsed)
  const railWidth = usePanels((s) => s.railWidth)
  const setRailWidth = usePanels((s) => s.setRailWidth)

  const dockedCount = Object.values(windows).filter((w) => w?.docked).length
  const active = dockedCount > 0

  // Drag the rail's LEFT edge to resize its width (right-anchored: dragging left
  // widens). Mirrors the ScoresPanel height-resize.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const sx = e.clientX
    const sw = railWidth
    document.body.classList.add('fp-dragging')
    const move = (ev: PointerEvent) => setRailWidth(sw - (ev.clientX - sx))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('fp-dragging')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={'dock-rail' + (active ? ' active' : '') + (collapsed ? ' collapsed' : '')}
      style={collapsed ? undefined : { width: railWidth }}
    >
      {!collapsed && <div className="dock-rail-resize" title="Drag to resize" onPointerDown={startResize} />}
      {collapsed ? (
        <button className="dock-rail-tab" onClick={() => setCollapsed(false)} title="Expand panels" aria-label="Expand panels">
          <IconLayoutSidebar size={16} />
          <span className="dock-rail-tab-label">Panels</span>
          <span className="dock-rail-badge">{dockedCount}</span>
        </button>
      ) : (
        <div className="dock-rail-head">
          <Text className="dock-rail-title" component="span">
            Panels
          </Text>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            title="Collapse panels"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse panels"
          >
            <IconLayoutSidebarRightExpand size={16} />
          </ActionIcon>
        </div>
      )}
      {/* Portal target — kept mounted always so docking is race-free. */}
      <div id="dock-rail-slot" className="dock-rail-slot" hidden={collapsed} />
    </div>
  )
}
