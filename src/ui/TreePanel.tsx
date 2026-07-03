import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { TreeModel, TreeColorBy } from '../tree/TreeModel'
import type { GroupModel } from '../analysis/cluster/GroupModel'
import { layoutTree, radialXY, type LaidNode } from '../tree/layout'
import type { GapHandling } from '../analysis/cluster/distance'
import { useEditorSnapshot } from './useEditor'

interface Props {
  ctrl: EditorController
  model: TreeModel
  group?: GroupModel | null
  onClose: () => void
  onToast: (msg: string) => void
}

export function TreePanel({ ctrl, model, group, onClose, onToast }: Props) {
  const snap = useEditorSnapshot(ctrl)
  useSyncExternalStore(
    (fn) => model.subscribe(fn),
    () => `${model.mode}|${model.colorBy}|${model.showBootstrap}|${model.isComputing()}|${model.current() ? 1 : 0}`,
  )
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const view = useRef({ scale: 1, ox: 0, oy: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [gap, setGap] = useState<GapHandling>('pairwise')
  const [boot, setBoot] = useState(false)

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
      const H = Math.max(120, rect.height - 88)
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
      const layout = layoutTree(tree)
      const { scale, ox, oy } = view.current
      const nodes = [...layout.nodes.values()]

      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.strokeStyle = th.edge
      ctx.font = `12px ${th.font}`
      ctx.textBaseline = 'middle'

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
        drawDecorations(ctx, nodes, (n) => ({ x: px(n.x), y: py(n.y) }), tree, model, nameColor, th, {
          dendro: true,
          maxLabelW: W - margin - 11,
          leafSpacing,
        })
      } else {
        const cx = W / 2 + ox
        const cy = H / 2 + oy
        const R = (Math.min(W, H) / 2 - 60) * scale
        const polar = (radius: number, angle: number) => ({
          x: cx + radius * R * Math.cos(angle),
          y: cy + radius * R * Math.sin(angle),
        })
        // edges — an arc at the parent's radius spanning its children, then a
        // radial spoke out to each child (classic radial phylogram).
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
        drawDecorations(ctx, nodes, (n) => polar(n.radius, n.angle), tree, model, nameColor, th, {
          dendro: false,
          maxLabelW: 150,
          leafSpacing: Infinity,
        })
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

  // Interaction: drag to pan, wheel to zoom, click to re-root, shift-click to swap.
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1
    view.current.scale = Math.max(0.3, Math.min(8, view.current.scale * f))
    redraw()
  }
  const onDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX - view.current.ox, y: e.clientY - view.current.oy }
  }
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current) return
    view.current.ox = e.clientX - drag.current.x
    view.current.oy = e.clientY - drag.current.y
    redraw()
  }
  const onUp = () => (drag.current = null)
  const onClick = (e: React.MouseEvent) => {
    const tree = model.current()
    const canvas = canvasRef.current
    if (!tree || !canvas) return
    // Hit-test against drawn node positions (recompute the same mapping).
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const hit = hitTest(canvas, model, mx, my)
    if (hit === null) return
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
    onToast(model.current() ? `Tree built (${ctrl.store.height} leaves)` : 'Tree build failed')
    redraw()
  }

  return (
    <div className="tree-panel" ref={wrapRef}>
      <div className="tree-head">
        <span className="scores-title">Phylogenetic tree</span>
        <button className="scores-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      <div className="tree-controls">
        <button className="btn" onClick={() => void buildTree()} disabled={model.isComputing()}>
          {model.isComputing() ? 'Building…' : 'Build'}
        </button>
        <label className="cluster-check">
          <input type="checkbox" checked={boot} onChange={(e) => setBoot(e.target.checked)} /> Bootstrap
        </label>
        <select className="select" value={gap} onChange={(e) => setGap(e.target.value as GapHandling)} title="Gap handling">
          <option value="pairwise">Pairwise</option>
          <option value="global">Global</option>
        </select>
        <div className="tree-spacer" />
        <select className="select" value={model.mode} onChange={(e) => model.setMode(e.target.value as 'dendrogram' | 'radial')}>
          <option value="dendrogram">Dendrogram</option>
          <option value="radial">Radial</option>
        </select>
        <select className="select" value={model.colorBy} onChange={(e) => model.setColorBy(e.target.value as TreeColorBy)} title="Leaf color">
          <option value="cluster">By cluster</option>
          <option value="phylum">By phylum</option>
          <option value="none">No color</option>
        </select>
        <label className="cluster-check">
          <input type="checkbox" checked={model.showBootstrap} onChange={(e) => model.setShowBootstrap(e.target.checked)} /> Support
        </label>
      </div>
      <canvas
        ref={canvasRef}
        className="tree-canvas"
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onClick={onClick}
      />
      <div className="tree-hint">drag to pan · wheel to zoom · click a node to re-root · shift-click to swap</div>
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
  nameColor: Map<string, string>,
  th: TreeTheme,
  opts: DecoOpts,
): void {
  if (!tree) return
  const lineHeight = 13
  // Draw every Nth label when leaves are packed tighter than the line height.
  const stride = opts.dendro && opts.leafSpacing < lineHeight ? Math.ceil(lineHeight / Math.max(1, opts.leafSpacing)) : 1
  let leafIdx = -1
  for (const ln of nodes) {
    const p = pos(ln)
    const n = ln.node
    if (n.children.length === 0) {
      leafIdx++
      // leaf color dot (ringed with the panel color for contrast)
      const color = model.colorBy === 'cluster' ? nameColor.get(n.name ?? '') : undefined
      if (color) {
        ctx.beginPath()
        ctx.arc(p.x + (opts.dendro ? 5 : 0), p.y, 3.5, 0, 2 * Math.PI)
        ctx.fillStyle = color
        ctx.fill()
        ctx.lineWidth = 1
        ctx.strokeStyle = th.panel
        ctx.stroke()
      }
      if (stride > 1 && leafIdx % stride !== 0) continue
      ctx.fillStyle = th.text
      const label = truncate(ctx, n.name ?? '', opts.maxLabelW)
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
  // restore edge stroke defaults for any subsequent drawing
  ctx.lineWidth = 1.5
  ctx.strokeStyle = th.edge
  ctx.textAlign = 'left'
}

/** Recompute node canvas positions and return the id of the node nearest (mx,my). */
function hitTest(canvas: HTMLCanvasElement, model: TreeModel, mx: number, my: number): number | null {
  const tree = model.current()
  if (!tree) return null
  const layout = layoutTree(tree)
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
