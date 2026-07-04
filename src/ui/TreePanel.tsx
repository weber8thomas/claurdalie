import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ActionIcon, Button, Checkbox, Select } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import type { EditorController } from '../editor/EditorController'
import type { TreeModel, TreeColorBy } from '../tree/TreeModel'
import type { GroupModel } from '../analysis/cluster/GroupModel'
import { layoutTree, radialXY, type LaidNode } from '../tree/layout'
import { treeStats, nodeInfo, patristic, type NodeInfo } from '../tree/metrics'
import { serializeNewick } from '../tree/newick'
import type { GapHandling } from '../analysis/cluster/distance'
import { useEditorSnapshot } from './useEditor'

interface Props {
  ctrl: EditorController
  model: TreeModel
  group?: GroupModel | null
  onClose: () => void
  onToast: (msg: string) => void
}

interface HoverState {
  x: number
  y: number
  lines: string[]
}

export function TreePanel({ ctrl, model, group, onClose, onToast }: Props) {
  const snap = useEditorSnapshot(ctrl)
  useSyncExternalStore(
    (fn) => model.subscribe(fn),
    () => `${model.mode}|${model.colorBy}|${model.showBootstrap}|${model.branchLengths}|${model.isComputing()}|${model.version()}`,
  )
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const view = useRef({ scale: 1, ox: 0, oy: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [gap, setGap] = useState<GapHandling>('pairwise')
  const [boot, setBoot] = useState(false)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<number[]>([])
  const [dist, setDist] = useState<number | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)

  // Live snapshot of highlight state the imperative draw() reads without
  // re-creating the render effect on every keystroke / selection.
  const dyn = useRef({ query, sel })
  dyn.current.query = query
  dyn.current.sel = sel

  const tree = model.current()
  const stats = tree ? treeStats(tree) : null

  // Leaf name → cluster color (when coloring by cluster).
  const nameColor = useMemo(() => {
    const m = new Map<string, string>()
    if (group) {
      for (let v = 0; v < ctrl.store.height; v++) {
        const c = group.colorOfVisualRow(v)
        if (c) m.set(ctrl.store.rowName(v), c)
      }
    }
    return m
  }, [group, snap.rows, model.colorBy]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')!

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = wrap.getBoundingClientRect()
      const W = rect.width
      const H = rect.height
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      const th = readTreeTheme(snap.dark)
      const tree = model.current()
      if (!tree) {
        ctx.fillStyle = th.muted
        ctx.font = `13px ${th.font}`
        ctx.fillText('No tree yet — press Build.', 16, 28)
        return
      }
      const layout = layoutTree(tree, { cladogram: !model.branchLengths })
      const { scale, ox, oy } = view.current
      const nodes = [...layout.nodes.values()]

      // Highlight state read live from the ref.
      const q = dyn.current.query.trim().toLowerCase()
      const matchSet = q ? new Set(tree.leaves.filter((n) => n.toLowerCase().includes(q)).map((n) => n.toLowerCase())) : null
      const selSet = new Set(dyn.current.sel)

      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.strokeStyle = th.edge
      ctx.font = `12px ${th.font}`
      ctx.textBaseline = 'middle'

      const deco = { matchSet, selSet, nameColor, th }

      if (model.mode === 'dendrogram') {
        const margin = 12
        const labelW = 96
        const plotW = (W - margin * 2 - labelW) * scale
        const plotH = (H - margin * 2) * scale
        const px = (x: number) => margin + ox + x * plotW
        const py = (y: number) => margin + oy + y * plotH
        // edges — orthogonal elbows with softly rounded corners
        for (const ln of nodes) {
          for (const c of ln.node.children) {
            const cl = layout.nodes.get(c.id)!
            const x0 = px(ln.x)
            const y0 = py(ln.y)
            const cornerX = px(ln.x)
            const cornerY = py(cl.y)
            const x1 = px(cl.x)
            const y1 = py(cl.y)
            const r = Math.max(0, Math.min(6, Math.abs(cornerY - y0) / 2, Math.abs(x1 - cornerX) / 2))
            ctx.beginPath()
            ctx.moveTo(x0, y0)
            if (r > 0.5) {
              ctx.arcTo(cornerX, cornerY, x1, y1, r)
              ctx.lineTo(x1, y1)
            } else {
              ctx.lineTo(cornerX, cornerY)
              ctx.lineTo(x1, y1)
            }
            ctx.stroke()
          }
        }
        const leafSpacing = layout.leafCount > 1 ? plotH / (layout.leafCount - 1) : plotH
        drawDecorations(ctx, nodes, (n) => ({ x: px(n.x), y: py(n.y) }), tree, model, deco, { dendro: true, maxLabelW: W - margin - 11, leafSpacing })
        // scale bar (only meaningful when x encodes branch length)
        if (model.branchLengths && layout.maxDepth > 0) drawScaleBar(ctx, W, H, plotW, layout.maxDepth, th)
      } else {
        const cx = W / 2 + ox
        const cy = H / 2 + oy
        const R = (Math.min(W, H) / 2 - 60) * scale
        const polar = (radius: number, angle: number) => ({
          x: cx + radius * R * Math.cos(angle),
          y: cy + radius * R * Math.sin(angle),
        })
        // edges — an arc at the parent's radius spanning its children, then a
        // radial spoke out to each child (classic radial cladogram).
        for (const ln of nodes) {
          if (ln.node.children.length === 0) continue
          const kids = ln.node.children.map((c) => layout.nodes.get(c.id)!)
          const angles = kids.map((k) => k.angle)
          const a0 = Math.min(...angles)
          const a1 = Math.max(...angles)
          if (ln.radius > 0 && a1 > a0) {
            ctx.beginPath()
            ctx.arc(cx, cy, ln.radius * R, a0, a1)
            ctx.stroke()
          }
          for (const k of kids) {
            const p0 = polar(ln.radius, k.angle)
            const p1 = polar(k.radius, k.angle)
            ctx.beginPath()
            ctx.moveTo(p0.x, p0.y)
            ctx.lineTo(p1.x, p1.y)
            ctx.stroke()
          }
        }
        drawDecorations(ctx, nodes, (n) => polar(n.radius, n.angle), tree, model, deco, { dendro: false, maxLabelW: 150, leafSpacing: Infinity })
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    const off = model.subscribe(draw)
    // expose draw + the live view ref to the interaction handlers / hit-test
    ;(canvas as any).__draw = draw
    ;(canvas as any).__viewRef = view
    return () => {
      ro.disconnect()
      off()
    }
  }, [model, snap.dark, nameColor])

  const redraw = () => (canvasRef.current as any)?.__draw?.()

  // Redraw when highlight state (search / selection) changes.
  useEffect(redraw, [query, sel])

  // Interaction: drag to pan, wheel to zoom, hover for info, click to re-root,
  // shift-click to swap, alt-click two tips to measure their distance.
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1
    view.current.scale = Math.max(0.3, Math.min(8, view.current.scale * f))
    redraw()
  }
  const onDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX - view.current.ox, y: e.clientY - view.current.oy }
    setHover(null)
  }
  const localXY = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top }
  }
  const onMove = (e: React.MouseEvent) => {
    if (drag.current) {
      view.current.ox = e.clientX - drag.current.x
      view.current.oy = e.clientY - drag.current.y
      redraw()
      return
    }
    const tree = model.current()
    const canvas = canvasRef.current
    if (!tree || !canvas) return
    const { mx, my } = localXY(e)
    const hit = hitTest(canvas, model, mx, my)
    if (hit === null) {
      if (hover) setHover(null)
      return
    }
    const info = nodeInfo(tree, hit)
    if (info) setHover({ x: mx, y: my, lines: tipLines(info) })
  }
  const onUp = () => (drag.current = null)
  const onLeave = () => {
    drag.current = null
    setHover(null)
  }
  const onClick = (e: React.MouseEvent) => {
    const tree = model.current()
    const canvas = canvasRef.current
    if (!tree || !canvas) return
    const { mx, my } = localXY(e)
    const hit = hitTest(canvas, model, mx, my)
    if (hit === null) return
    if (e.altKey) {
      // Measure patristic distance between two tips.
      const node = model.nodeById(hit)
      if (!node || node.children.length > 0) {
        onToast('Alt-click a tip (leaf) to measure')
        return
      }
      const cur = dyn.current.sel
      const next = cur.length >= 2 || cur.includes(hit) ? [hit] : [...cur, hit]
      setSel(next)
      if (next.length === 2) {
        const d = patristic(tree, next[0], next[1])
        setDist(d)
        onToast(d == null ? 'No path' : `Distance ${fmtNum(d)}`)
      } else {
        setDist(null)
        onToast('Pick a second tip')
      }
      return
    }
    if (e.shiftKey) {
      model.swapAt(hit)
      onToast('Swapped node')
    } else {
      model.rerootAt(hit)
      onToast('Re-rooted')
    }
    redraw()
  }

  const buildTree = async () => {
    await model.build({ gap, zones: [], bootstrap: boot ? 100 : 0 })
    setSel([])
    setDist(null)
    onToast(model.current() ? `Tree built (${ctrl.store.height} leaves)` : 'Tree build failed')
    redraw()
  }

  const copyNewick = async () => {
    const t = model.current()
    if (!t) return
    try {
      await navigator.clipboard.writeText(serializeNewick(t))
      onToast('Newick copied')
    } catch {
      onToast('Copy failed')
    }
  }
  const saveNewick = () => {
    const t = model.current()
    if (!t) return
    downloadBlob(new Blob([serializeNewick(t)], { type: 'text/plain' }), 'tree.nwk')
    onToast('Saved tree.nwk')
  }
  const savePNG = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const out = document.createElement('canvas')
    out.width = canvas.width
    out.height = canvas.height
    const octx = out.getContext('2d')!
    octx.fillStyle = readTreeTheme(snap.dark).panel
    octx.fillRect(0, 0, out.width, out.height)
    octx.drawImage(canvas, 0, 0)
    const a = document.createElement('a')
    a.href = out.toDataURL('image/png')
    a.download = 'tree.png'
    a.click()
    onToast('Saved tree.png')
  }

  const hasTree = !!tree

  return (
    <div className="tree-panel">
      <div className="tree-head">
        <span className="panel-title">Phylogenetic tree</span>
        <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label="Close">
          <IconX size={16} />
        </ActionIcon>
      </div>
      <div className="tree-controls">
        <Button size="compact-xs" onClick={() => void buildTree()} loading={model.isComputing()}>
          Build
        </Button>
        <Checkbox size="xs" label="Bootstrap" checked={boot} onChange={(e) => setBoot(e.currentTarget.checked)} />
        <Select
          size="xs"
          w={110}
          title="Gap handling"
          data={[
            { value: 'pairwise', label: 'Pairwise' },
            { value: 'global', label: 'Global' },
          ]}
          value={gap}
          onChange={(v) => v && setGap(v as GapHandling)}
          allowDeselect={false}
        />
        <div className="tree-spacer" />
        <Select
          size="xs"
          w={130}
          data={[
            { value: 'dendrogram', label: 'Dendrogram' },
            { value: 'radial', label: 'Radial' },
          ]}
          value={model.mode}
          onChange={(v) => v && model.setMode(v as 'dendrogram' | 'radial')}
          allowDeselect={false}
        />
        <Select
          size="xs"
          w={120}
          title="Leaf color"
          data={[
            { value: 'cluster', label: 'By cluster' },
            { value: 'phylum', label: 'By phylum' },
            { value: 'none', label: 'No color' },
          ]}
          value={model.colorBy}
          onChange={(v) => v && model.setColorBy(v as TreeColorBy)}
          allowDeselect={false}
        />
        <Checkbox
          size="xs"
          label="Support"
          checked={model.showBootstrap}
          onChange={(e) => model.setShowBootstrap(e.currentTarget.checked)}
        />
      </div>
      <div className="tree-controls tree-controls-2">
        <input
          className="tree-search"
          type="search"
          placeholder="Search tips…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!hasTree}
        />
        <button className="btn" onClick={() => model.ladderize()} disabled={!hasTree} title="Sort clades by subtree size">
          Ladderize
        </button>
        <label className="cluster-check" title="Scale branches by evolutionary distance (phylogram) vs equal steps (cladogram)">
          <input type="checkbox" checked={model.branchLengths} onChange={(e) => model.setBranchLengths(e.target.checked)} /> Branch lengths
        </label>
        <div className="tree-spacer" />
        <button className="btn" onClick={() => void copyNewick()} disabled={!hasTree} title="Copy Newick to clipboard">
          Copy Newick
        </button>
        <button className="btn" onClick={saveNewick} disabled={!hasTree} title="Download Newick (.nwk)">
          .nwk
        </button>
        <button className="btn" onClick={savePNG} disabled={!hasTree} title="Save tree image (.png)">
          PNG
        </button>
      </div>
      <div className="tree-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="tree-canvas"
          onWheel={onWheel}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onLeave}
          onClick={onClick}
        />
        {hover && (
          <div className="tree-tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            {hover.lines.map((l, i) => (
              <div key={i} className={i === 0 ? 'tree-tip-title' : undefined}>
                {l}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="tree-foot">
        {stats && (
          <span className="tree-stats">
            {stats.leaves} tips · length {fmtNum(stats.totalLength)} · height {fmtNum(stats.height)} · mean {fmtNum(stats.meanBranch)}
          </span>
        )}
        {dist != null && <span className="tree-dist">distance {fmtNum(dist)}</span>}
        <span className="tree-spacer" />
        <span className="tree-hint">drag pan · wheel zoom · click re-root · shift swap · alt-click 2 tips to measure</span>
      </div>
    </div>
  )
}

// ---- drawing helpers (module-scope so both modes share them) --------------

interface TreeTheme {
  edge: string
  text: string
  muted: string
  accent: string
  danger: string
  panel: string
  font: string
}

/** Pull the live design tokens off the document so the tree tracks the app theme. */
function readTreeTheme(dark: boolean): TreeTheme {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb
  return {
    edge: v('--muted', dark ? '#9099a4' : '#626a76'),
    text: v('--text', dark ? '#e6e8ea' : '#16181c'),
    muted: v('--muted', dark ? '#9099a4' : '#626a76'),
    accent: v('--accent', dark ? '#2dd4bf' : '#0d9488'),
    danger: v('--danger', dark ? '#f87171' : '#dc2626'),
    panel: v('--panel', dark ? '#16181c' : '#ffffff'),
    font: v('--font', "'Inter', system-ui, sans-serif"),
  }
}

/** Clip `text` to `maxW` px with a trailing ellipsis (binary search on length). */
function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0) return ''
  if (ctx.measureText(text).width <= maxW) return text
  const ell = '…'
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + ell).width <= maxW) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? text.slice(0, lo) + ell : ''
}

interface DecoState {
  matchSet: Set<string> | null
  selSet: Set<number>
  nameColor: Map<string, string>
  th: TreeTheme
}

interface DecoOpts {
  dendro: boolean
  maxLabelW: number
  /** Vertical px between adjacent leaves; used to thin labels when they collide. */
  leafSpacing: number
}

function drawDecorations(
  ctx: CanvasRenderingContext2D,
  nodes: LaidNode[],
  pos: (n: LaidNode) => { x: number; y: number },
  tree: ReturnType<TreeModel['current']>,
  model: TreeModel,
  deco: DecoState,
  opts: DecoOpts,
): void {
  if (!tree) return
  const { th, matchSet, selSet, nameColor } = deco
  const lineHeight = 13
  // Draw every Nth label when leaves are packed tighter than the line height.
  const stride = opts.dendro && opts.leafSpacing < lineHeight ? Math.ceil(lineHeight / Math.max(1, opts.leafSpacing)) : 1
  let leafIdx = -1
  for (const ln of nodes) {
    const p = pos(ln)
    const n = ln.node
    if (n.children.length === 0) {
      leafIdx++
      const name = n.name ?? ''
      const dotX = p.x + (opts.dendro ? 5 : 0)
      // selection ring for distance measurement
      if (selSet.has(n.id)) {
        ctx.beginPath()
        ctx.arc(dotX, p.y, 6, 0, 2 * Math.PI)
        ctx.strokeStyle = th.accent
        ctx.lineWidth = 2
        ctx.stroke()
      }
      // leaf color dot (ringed with the panel color for contrast)
      const color = model.colorBy === 'cluster' ? nameColor.get(name) : undefined
      if (color) {
        ctx.beginPath()
        ctx.arc(dotX, p.y, 3.5, 0, 2 * Math.PI)
        ctx.fillStyle = color
        ctx.fill()
        ctx.lineWidth = 1
        ctx.strokeStyle = th.panel
        ctx.stroke()
      }
      if (stride > 1 && leafIdx % stride !== 0) continue
      const matched = matchSet ? matchSet.has(name.toLowerCase()) : null
      ctx.fillStyle = matched === true ? th.accent : matchSet && !matched ? th.muted : th.text
      ctx.font = matched === true ? `bold 12px ${th.font}` : `12px ${th.font}`
      const label = truncate(ctx, name, opts.maxLabelW)
      if (opts.dendro) {
        ctx.textAlign = 'left'
        ctx.fillText(label, p.x + 11, p.y)
      } else {
        // Radial: anchor labels away from the centre so they don't overlap the tree.
        const leftHalf = Math.cos(ln.angle) < 0
        ctx.textAlign = leftHalf ? 'right' : 'left'
        ctx.fillText(label, p.x + (leftHalf ? -6 : 6), p.y)
      }
    } else if (model.showBootstrap && n.support !== undefined && tree.bootstrap > 0) {
      // bootstrap disc: accent above threshold, danger below
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI)
      ctx.fillStyle = n.support >= model.bootstrapThreshold ? th.accent : th.danger
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = th.panel
      ctx.stroke()
    }
  }
  // restore edge stroke / font defaults for any subsequent drawing
  ctx.lineWidth = 1.5
  ctx.strokeStyle = th.edge
  ctx.font = `12px ${th.font}`
  ctx.textAlign = 'left'
}

/** A distance scale bar in the bottom-left corner of a phylogram. */
function drawScaleBar(ctx: CanvasRenderingContext2D, W: number, H: number, plotW: number, maxDepth: number, th: TreeTheme): void {
  const pxPerDist = plotW / maxDepth
  if (!isFinite(pxPerDist) || pxPerDist <= 0) return
  const unit = niceNum(90 / pxPerDist)
  const barPx = unit * pxPerDist
  if (barPx < 8 || barPx > W - 24) return
  const x0 = 16
  const y0 = H - 16
  ctx.save()
  // panel-colored backing so the bar stays legible over any leaf beneath it
  ctx.fillStyle = th.panel
  ctx.globalAlpha = 0.85
  ctx.fillRect(x0 - 6, y0 - 22, barPx + 12, 30)
  ctx.globalAlpha = 1
  ctx.strokeStyle = th.muted
  ctx.fillStyle = th.muted
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x0 + barPx, y0)
  ctx.moveTo(x0, y0 - 3)
  ctx.lineTo(x0, y0 + 3)
  ctx.moveTo(x0 + barPx, y0 - 3)
  ctx.lineTo(x0 + barPx, y0 + 3)
  ctx.stroke()
  ctx.font = `11px ${th.font}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(fmtNum(unit), x0 + barPx / 2, y0 - 4)
  ctx.restore()
}

/** Round `x` down to a 1/2/5 × 10ⁿ "nice" number for axis ticks. */
function niceNum(x: number): number {
  if (x <= 0) return 1
  const exp = Math.floor(Math.log10(x))
  const f = x / 10 ** exp
  const nf = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10
  return nf * 10 ** exp
}

/** Compact numeric formatting (3 significant figures). */
function fmtNum(x: number): string {
  if (!isFinite(x)) return '—'
  if (x === 0) return '0'
  return String(+x.toPrecision(3))
}

/** Tooltip text lines for a hovered node. */
function tipLines(info: NodeInfo): string[] {
  const lines = [info.isLeaf ? info.name || '(tip)' : `Clade · ${info.leafCount} tips`]
  lines.push(`branch ${fmtNum(info.length)}`)
  lines.push(`depth ${fmtNum(info.depth)}`)
  if (info.support !== undefined) lines.push(`support ${Math.round(info.support * 100)}%`)
  return lines
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** Recompute node canvas positions and return the id of the node nearest (mx,my). */
function hitTest(canvas: HTMLCanvasElement, model: TreeModel, mx: number, my: number): number | null {
  const tree = model.current()
  if (!tree) return null
  const layout = layoutTree(tree, { cladogram: !model.branchLengths })
  const dpr = window.devicePixelRatio || 1
  const W = canvas.width / dpr
  const H = canvas.height / dpr
  // Mirror the draw() mapping using the live view stored on the element.
  const v = (canvas as any).__viewRef?.current ?? { scale: 1, ox: 0, oy: 0 }
  let best: number | null = null
  let bestD = 14 * 14
  const consider = (x: number, y: number, id: number) => {
    const d = (x - mx) ** 2 + (y - my) ** 2
    if (d < bestD) {
      bestD = d
      best = id
    }
  }
  if (model.mode === 'dendrogram') {
    const margin = 12
    const labelW = 96
    const plotW = (W - margin * 2 - labelW) * v.scale
    const plotH = (H - margin * 2) * v.scale
    for (const ln of layout.nodes.values()) consider(margin + v.ox + ln.x * plotW, margin + v.oy + ln.y * plotH, ln.node.id)
  } else {
    const cx = W / 2 + v.ox
    const cy = H / 2 + v.oy
    const R = (Math.min(W, H) / 2 - 60) * v.scale
    for (const ln of layout.nodes.values()) {
      const { x, y } = radialXY(ln)
      consider(cx + x * R, cy + y * R, ln.node.id)
    }
  }
  return best
}
