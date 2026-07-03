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

      const dark = snap.dark
      const line = dark ? '#c8c8d0' : '#33333a'
      const text = dark ? '#e8e8ea' : '#1a1a1e'
      const tree = model.current()
      if (!tree) {
        ctx.fillStyle = dark ? '#8a8a94' : '#8a8a94'
        ctx.font = "13px system-ui, sans-serif"
        ctx.fillText('No tree yet — press Build.', 16, 28)
        return
      }
      const layout = layoutTree(tree)
      const { scale, ox, oy } = view.current
      const nodes = [...layout.nodes.values()]

      ctx.lineWidth = 1.2
      ctx.strokeStyle = line
      ctx.font = "11px system-ui, sans-serif"
      ctx.textBaseline = 'middle'

      if (model.mode === 'dendrogram') {
        const margin = 12
        const labelW = 96
        const plotW = (W - margin * 2 - labelW) * scale
        const plotH = (H - margin * 2) * scale
        const px = (x: number) => margin + ox + x * plotW
        const py = (y: number) => margin + oy + y * plotH
        // edges
        for (const ln of nodes) {
          for (const c of ln.node.children) {
            const cl = layout.nodes.get(c.id)!
            ctx.beginPath()
            ctx.moveTo(px(ln.x), py(ln.y))
            ctx.lineTo(px(ln.x), py(cl.y))
            ctx.lineTo(px(cl.x), py(cl.y))
            ctx.stroke()
          }
        }
        drawDecorations(ctx, nodes, layout, (n) => ({ x: px(n.x), y: py(n.y) }), tree, model, nameColor, text, true, labelW, W - margin)
      } else {
        const cx = W / 2 + ox
        const cy = H / 2 + oy
        const R = (Math.min(W, H) / 2 - 60) * scale
        const pt = (n: LaidNode) => {
          const { x, y } = radialXY(n)
          return { x: cx + x * R, y: cy + y * R }
        }
        for (const ln of nodes) {
          const a = pt(ln)
          for (const c of ln.node.children) {
            const cl = layout.nodes.get(c.id)!
            const b = pt(cl)
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
        drawDecorations(ctx, nodes, layout, pt, tree, model, nameColor, text, false, 0, 0)
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

function drawDecorations(
  ctx: CanvasRenderingContext2D,
  nodes: LaidNode[],
  _layout: ReturnType<typeof layoutTree>,
  pos: (n: LaidNode) => { x: number; y: number },
  tree: ReturnType<TreeModel['current']>,
  model: TreeModel,
  nameColor: Map<string, string>,
  text: string,
  dendro: boolean,
  labelW: number,
  rightX: number,
): void {
  if (!tree) return
  for (const ln of nodes) {
    const p = pos(ln)
    const n = ln.node
    if (n.children.length === 0) {
      // leaf label + color dot
      const color = model.colorBy === 'cluster' ? nameColor.get(n.name ?? '') : undefined
      if (color) {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(p.x + (dendro ? 4 : 0), p.y, 3, 0, 2 * Math.PI)
        ctx.fill()
      }
      ctx.fillStyle = text
      const label = n.name ?? ''
      if (dendro) {
        ctx.textAlign = 'left'
        ctx.fillText(label, p.x + 9, p.y, labelW)
      } else {
        ctx.textAlign = 'left'
        ctx.fillText(label, p.x + 5, p.y)
      }
    } else if (model.showBootstrap && n.support !== undefined && tree.bootstrap > 0) {
      // bootstrap disc: green above threshold, red below
      ctx.fillStyle = n.support >= model.bootstrapThreshold ? '#22c55e' : '#ef5d6c'
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI)
      ctx.fill()
    }
  }
  ctx.textAlign = 'left'
  void rightX
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
