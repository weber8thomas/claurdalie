import { ActionIcon, Text } from '@mantine/core'
import { IconLayoutSidebarRightCollapse, IconLayoutSidebarRightExpand } from '@tabler/icons-react'
import { usePanels } from '../panelsStore'

/**
 * The right-side dock rail ("volet"): a collapsible column that hosts panels the
 * user has docked. It always renders the `#dock-rail-slot` portal target so a
 * FloatingPanel can portal into it the moment it is docked; the rail chrome shows
 * only when at least one panel is actually docked.
 */
export function DockRail() {
  const windows = usePanels((s) => s.windows)
  const collapsed = usePanels((s) => s.railCollapsed)
  const setCollapsed = usePanels((s) => s.setRailCollapsed)

  const dockedCount = Object.values(windows).filter((w) => w?.docked).length
  const active = dockedCount > 0

  return (
    <div className={'dock-rail' + (active ? ' active' : '') + (collapsed ? ' collapsed' : '')}>
      <div className="dock-rail-head">
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          title={collapsed ? 'Expand dock' : 'Collapse dock'}
          onClick={() => setCollapsed(!collapsed)}
          aria-label="Toggle dock"
        >
          {collapsed ? <IconLayoutSidebarRightCollapse size={16} /> : <IconLayoutSidebarRightExpand size={16} />}
        </ActionIcon>
        {!collapsed && (
          <Text className="dock-rail-title" component="span">
            Docked panels
          </Text>
        )}
      </div>
      {/* Portal target — kept mounted always so docking is race-free. */}
      <div id="dock-rail-slot" className="dock-rail-slot" hidden={collapsed} />
    </div>
  )
}
