import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { EditorController } from '../editor/EditorController'
import type { StructureController } from '../structure/StructureController'
import type { VariantModel } from '../analysis/variant/VariantModel'
import { impactColor, type Variant } from '../analysis/variant/types'
import { Icon } from './Icon'

interface Props {
  ctrl: EditorController
  structure: StructureController | null
  model: VariantModel
  /** Seed the add-form (from a right-click "Add variant here"). */
  prefill?: { seqName: string; position: number } | null
  onConsumePrefill?: () => void
  onClose: () => void
  onToast?: (msg: string) => void
}

const RESIDUES = 'ACDEFGHIKLMNPQRSTVWY'.split('')

/**
 * Variant / mutation-effect panel. Chrome only — the impact pins are drawn by
 * the GridRenderer overlay and the 3D highlight lives in the viewer; this panel
 * just adds/imports variants, picks a scorer, and lists the results.
 */
export function VariantPanel({ ctrl, structure, model, prefill, onConsumePrefill, onClose, onToast }: Props) {
  useSyncExternalStore(model.subscribe, () => versionKey(model))
  const dark = ctrl.isDark()
  const fileRef = useRef<HTMLInputElement>(null)

  const names = model.sequenceNames()
  const [seqName, setSeqName] = useState(names[0] ?? '')
  const [posStr, setPosStr] = useState('')
  const [to, setTo] = useState('A')
  const [label, setLabel] = useState('')
  const [importErrors, setImportErrors] = useState<string[]>([])

  // Keep the selected sequence valid as the alignment changes.
  useEffect(() => {
    if (names.length && !names.includes(seqName)) setSeqName(names[0])
  }, [names, seqName])

  // Clear any 3D focus when the panel unmounts.
  useEffect(() => () => model.clearFocus(), [model])

  // Seed the add-form from a right-click "Add variant here", then consume it.
  useEffect(() => {
    if (!prefill) return
    setSeqName(prefill.seqName)
    setPosStr(String(prefill.position))
    onConsumePrefill?.()
  }, [prefill, onConsumePrefill])

  const pos = Number(posStr)
  const ungapped = seqName ? model.ungappedLength(seqName) : 0
  const from = seqName && Number.isInteger(pos) ? model.residueAt(seqName, pos) : null
  const canAdd = !!seqName && Number.isInteger(pos) && pos >= 1 && pos <= ungapped && !!to

  const results = model.results()
  const source = model.sources().find((s) => s.id === model.sourceId())

  const addVariant = () => {
    if (!canAdd) return
    const v: Variant = {
      seqName,
      position: pos,
      from: from ?? undefined,
      to,
      label: label.trim() || undefined,
    }
    model.add(v)
    setPosStr('')
    setLabel('')
  }

  const onImportFile = async (file: File) => {
    const errors = model.importText(await file.text())
    setImportErrors(errors.map((e) => `line ${e.line}: ${e.message}`))
    onToast?.(`Imported variants from ${file.name}`)
  }

  const scoreAll = () => void model.scoreAll()

  return (
    <div className="variant-panel">
      <div className="align-chrome">
        <span className="align-title">Variants</span>
        <select
          className="select"
          value={model.sourceId()}
          onChange={(e) => model.setSource(e.target.value)}
          title="Choose a mutation-effect scorer"
        >
          {model.sources().map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="align-close" title="Close" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>

      {/* Add form */}
      <div className="variant-add">
        <select className="select vp-seq" value={seqName} onChange={(e) => setSeqName(e.target.value)} title="Sequence">
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <input
          className="select vp-pos"
          type="number"
          min={1}
          max={ungapped || undefined}
          value={posStr}
          placeholder="pos"
          onChange={(e) => setPosStr(e.target.value)}
          title={`1-based ungapped position (1..${ungapped})`}
        />
        <span className="vp-from" title="Reference residue at this position">
          {from ?? '·'}
        </span>
        <span className="vp-arrow">→</span>
        <select className="select vp-to" value={to} onChange={(e) => setTo(e.target.value)} title="Alternate residue">
          {RESIDUES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          <option value="-">− (del)</option>
        </select>
        <input
          className="select vp-label"
          value={label}
          placeholder="label (optional)"
          onChange={(e) => setLabel(e.target.value)}
        />
        <button className="align-btn" disabled={!canAdd} onClick={addVariant} title="Add variant">
          Add
        </button>
      </div>

      {/* Actions */}
      <div className="variant-actions">
        <button className="align-btn" onClick={() => fileRef.current?.click()} title="Import CSV/TSV (seq,pos,from,to,label)">
          <Icon name="import" size={13} /> Import
        </button>
        <button
          className="align-btn primary"
          disabled={model.isBusy() || results.length === 0}
          onClick={scoreAll}
          title="Score all variants with the selected source"
        >
          {model.isBusy() ? 'Scoring…' : 'Score'}
        </button>
        {model.isBusy() && (
          <button className="align-cancel" onClick={() => model.cancel()}>
            Cancel
          </button>
        )}
        {results.length > 0 && (
          <button className="align-btn" onClick={() => model.clear()} title="Remove all variants">
            Clear
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onImportFile(f)
            e.target.value = ''
          }}
        />
      </div>

      {model.errorText() && (
        <div className="align-error">
          {model.errorText()}
          {model.errorKindText() === 'blocked' && (
            <div className="align-note">The endpoint is unreachable — switch to the Local scorer to score offline.</div>
          )}
        </div>
      )}
      {importErrors.length > 0 && (
        <div className="align-error">
          {importErrors.slice(0, 4).map((e, i) => (
            <div key={i}>{e}</div>
          ))}
          {importErrors.length > 4 && <div>…and {importErrors.length - 4} more</div>}
        </div>
      )}

      {/* Results */}
      {results.length === 0 ? (
        <div className="align-note">
          Add a substitution above, import a CSV/TSV, or right-click a residue → “Add variant here”.
          {source?.needsNetwork ? ' Then press Score.' : ' It scores automatically.'}
        </div>
      ) : (
        <div className="variant-results">
          <table className="vp-table">
            <thead>
              <tr>
                <th>variant</th>
                <th>col</th>
                <th>impact</th>
                <th>driver</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr
                  key={r.key}
                  className={r.visualRow < 0 ? 'vp-missing' : ''}
                  onMouseEnter={() => model.focus(r.variant)}
                  onMouseLeave={() => model.clearFocus()}
                  onClick={() => structure && model.focus(r.variant)}
                  title={r.visualRow < 0 ? 'sequence not in this alignment' : 'hover to spotlight in 3D'}
                >
                  <td className="vp-name">
                    {r.variant.label ? (
                      <span>{r.variant.label}</span>
                    ) : (
                      <span>
                        {r.variant.seqName} <b>{(r.variant.from ?? '·') + r.variant.position + r.variant.to}</b>
                      </span>
                    )}
                  </td>
                  <td>{r.column == null ? '—' : r.column + 1}</td>
                  <td>
                    {r.score == null ? (
                      '—'
                    ) : (
                      <span className="vp-impact">
                        <span className="vp-chip" style={{ background: impactColor(r.score, dark) }} />
                        {r.score} <span className="vp-band">{r.band}</span>
                      </span>
                    )}
                  </td>
                  <td className="vp-note">{r.note ?? ''}</td>
                  <td>
                    <button
                      className="vp-del"
                      title="Remove"
                      onClick={(e) => {
                        e.stopPropagation()
                        model.remove(r.key)
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** A cheap store-version string so useSyncExternalStore re-renders on any change. */
function versionKey(model: VariantModel): string {
  const r = model.results()
  return `${model.sourceId()}|${model.isBusy()}|${model.errorText() ?? ''}|${r.length}|${r
    .map((x) => `${x.key}:${x.score}:${x.column}`)
    .join(',')}`
}
