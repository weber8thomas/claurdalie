import { useState, useSyncExternalStore } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { MotifModel } from '../analysis/motif/MotifModel'

interface Props {
  ctrl: EditorController
  model: MotifModel
  onClose: () => void
}

/**
 * Motif (GCG FindPatterns) search box. Chrome only — the matched residues are
 * drawn by the GridRenderer's high-contrast overlay, never in React.
 */
export function MotifSearch({ model, onClose }: Props) {
  useSyncExternalStore(
    (fn) => model.subscribe(fn),
    () => `${model.getPattern()}|${model.matchCount()}|${model.currentIndex()}|${model.isActive()}|${model.errorText() ?? ''}`,
  )
  const [text, setText] = useState(model.getPattern())

  const count = model.matchCount()
  const err = model.errorText()
  const idx = model.currentIndex()

  const onChange = (v: string) => {
    setText(v)
    model.setPattern(v)
  }

  return (
    <div className="motif-panel">
      <div className="cluster-head">
        <span className="scores-title">Motif search</span>
        <button className="scores-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      <div className="cluster-section">
        <input
          className="select motif-input"
          value={text}
          placeholder="e.g. C-X-X-C  →  C(A,C,D){2}C"
          spellCheck={false}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') model.findNext()
          }}
        />
        <div className="motif-hint">
          Residues, ambiguity <code>B Z X</code>, groups <code>(A,C)</code>, repeats{' '}
          <code>{'{m,n}'}</code>, <code>~</code> not, <code>&lt;</code>/<code>&gt;</code> anchors.
        </div>
      </div>

      {err && <div className="motif-error">{err}</div>}

      <div className="cluster-actions">
        <button className="btn" onClick={() => model.findPrev()} disabled={count === 0} title="Previous match">
          ‹ Prev
        </button>
        <button className="btn" onClick={() => model.findNext()} disabled={count === 0} title="Next match">
          Next ›
        </button>
        <label className="cluster-check">
          <input type="checkbox" checked={model.isActive()} disabled={count === 0} onChange={(e) => model.setActive(e.target.checked)} />
          Highlight
        </label>
        <span className="motif-count">
          {count === 0 ? (text.trim() && !err ? 'no matches' : '') : `${idx + 1} / ${count}`}
        </span>
      </div>
    </div>
  )
}
