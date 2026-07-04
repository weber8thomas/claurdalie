import { ActionIcon, Text } from '@mantine/core'
import { IconLayoutSidebar, IconLayoutSidebarRightExpand } from '@tabler/icons-react'
import { usePanels } from '../panelsStore'

/**
 * The right-side dock rail ("Panels"): a collapsible column that hosts panels the
 * user has docked. It always renders the `#dock-rail-slot` portal target so a
 * FloatingPanel can portal into it the moment it is docked; the rail chrome shows
 * only when at least one panel is docked. Collapsed, it shrinks to a thin labeled
 * "Panels" column with an icon.
 */
export function DockRail() {
  const windows = usePanels((s) => s.windows)
  const collapsed = usePanels((s) => s.railCollapsed)
  const setCollapsed = usePanels((s) => s.setRailCollapsed)

  const dockedCount = Object.values(windows).filter((w) => w?.docked).length
  const active = dockedCount > 0

  return (
    <div className={'dock-rail' + (active ? ' active' : '') + (collapsed ? ' collapsed' : '')}>
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
