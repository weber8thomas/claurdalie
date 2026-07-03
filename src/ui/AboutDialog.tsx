import { useEffect } from 'react'
import { APP_VERSION, REPO_URL } from '../version'
import { Icon } from './Icon'

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
          <svg className="brand-mark" viewBox="0 0 100 100" width="40" height="40" aria-hidden="true">
            <rect width="100" height="100" rx="22" fill="#12141c" />
            <rect x="14" y="16" width="15" height="18" rx="3" fill="#2bb3a3" />
            <rect x="33" y="16" width="15" height="18" rx="3" fill="#f3a83c" />
            <rect x="52" y="16" width="15" height="18" rx="3" fill="#5b7cf0" />
            <rect x="71" y="16" width="15" height="18" rx="3" fill="#ef5d6c" />
            <rect x="14" y="40" width="15" height="18" rx="3" fill="#f3a83c" />
            <rect x="33" y="40" width="15" height="18" rx="3" fill="#5b7cf0" />
            <rect x="52" y="40" width="15" height="18" rx="3" fill="#2bb3a3" opacity="0.22" />
            <rect x="71" y="40" width="15" height="18" rx="3" fill="#2bb3a3" />
            <rect x="14" y="64" width="15" height="18" rx="3" fill="#5b7cf0" />
            <rect x="33" y="64" width="15" height="18" rx="3" fill="#ef5d6c" />
            <rect x="52" y="64" width="15" height="18" rx="3" fill="#f3a83c" />
            <rect x="71" y="64" width="15" height="18" rx="3" fill="#2bb3a3" />
          </svg>
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
