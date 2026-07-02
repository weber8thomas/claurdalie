import { useEffect, useRef } from 'react'
import { EditorController } from '../editor/EditorController'
import { attachInteraction } from '../editor/interaction'
import { parseFasta } from '../core/io/fasta'
import { LIGHT_FASTA } from '../datasets/light'

interface Props {
  onReady: (ctrl: EditorController) => void
  onToggleHelp: () => void
}

export function AlignmentCanvas({ onReady, onToggleHelp }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctrl = new EditorController(canvas)
    ctrl.loadSequences(parseFasta(LIGHT_FASTA))

    const applySize = () => {
      const r = wrap.getBoundingClientRect()
      ctrl.renderer.setSize(r.width, r.height, window.devicePixelRatio || 1)
    }
    applySize()
    const ro = new ResizeObserver(applySize)
    ro.observe(wrap)

    const detach = attachInteraction(canvas, ctrl, { toggleHelp: onToggleHelp })
    onReady(ctrl)

    return () => {
      detach()
      ro.disconnect()
      ctrl.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas className="grid" ref={canvasRef} tabIndex={0} />
    </div>
  )
}
