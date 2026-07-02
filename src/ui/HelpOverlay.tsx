import { SHORTCUTS } from '../editor/keymap'

const GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))]

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <div className="kbd-grid">
          {GROUPS.map((g) => (
            <div key={g} style={{ display: 'contents' }}>
              <div className="kbd-group">{g}</div>
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <div key={s.keys} style={{ display: 'contents' }}>
                  <div>
                    <kbd>{s.keys}</kbd>
                  </div>
                  <div>{s.action}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 20 }}>
          Tip: turn on <strong>Edit mode</strong> (F2), then use Space / Delete and ⌘/Ctrl+← →
          to insert, remove and slide gaps. Shift-drag a residue to slide it; drag a name to reorder.
        </p>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
