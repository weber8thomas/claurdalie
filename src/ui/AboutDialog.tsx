import { useEffect } from 'react'
import { APP_VERSION, REPO_URL } from '../version'
import { Icon } from './Icon'
import { BrandMark } from './BrandMark'

export function AboutDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal about" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" title="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
        <div className="about-head">
          <BrandMark size={40} />
          <div>
            <h2 style={{ margin: 0 }}>
              Claurdalie <span className="about-ver">v{APP_VERSION}</span>
            </h2>
            <p className="hint" style={{ margin: '2px 0 0' }}>
              A fast, client-side multiple sequence alignment editor.
            </p>
          </div>
        </div>

        <p style={{ fontSize: 13, lineHeight: 1.55 }}>
          Edit alignments entirely in your browser — insert and slide gaps, reorder sequences
          (contiguous or not), and color residues by physico-chemical properties (ClustalX, Zappo,
          Taylor, hydrophobicity). Built to stay smooth on very large alignments (thousands of
          sequences × tens of thousands of columns) with a virtualized canvas renderer. Nothing is
          uploaded — your data stays local.
        </p>

        <div className="about-meta">
          <span>Vite · React · TypeScript · Canvas 2D</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source ↗
          </a>
        </div>

        <div style={{ marginTop: 18, textAlign: 'right' }}>
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
