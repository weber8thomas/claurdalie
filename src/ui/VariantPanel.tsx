import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ActionIcon, Button, NumberInput, Select, Text, TextInput } from '@mantine/core'
import { IconFileImport, IconX } from '@tabler/icons-react'
import type { EditorController } from '../editor/EditorController'
import type { StructureController } from '../structure/StructureController'
import type { VariantModel } from '../analysis/variant/VariantModel'
import { impactColor, type Variant } from '../analysis/variant/types'

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
  // Reflect structure fold state (busy / new mutant models / notes) too.
  useSyncExternalStore(structure ? structure.subscribe : noopSub, structure ? structure.getVersion : zero)
  const structBusy = structure?.snapshot().busy ?? false
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
      <div className="panel-head">
        <span className="panel-title">Variants</span>
        <Select
          size="xs"
          w={150}
          title="Choose a mutation-effect scorer"
          data={model.sources().map((s) => ({ value: s.id, label: s.label }))}
          value={model.sourceId()}
          onChange={(v) => v && model.setSource(v)}
          allowDeselect={false}
        />
        <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label="Close">
          <IconX size={16} />
        </ActionIcon>
      </div>

      {/* Add form */}
      <div className="variant-add">
        <Select
          size="xs"
          className="vp-seq"
          title="Sequence"
          data={names}
          value={seqName}
          onChange={(v) => v && setSeqName(v)}
          allowDeselect={false}
        />
        <NumberInput
          size="xs"
          className="vp-pos"
          min={1}
          max={ungapped || undefined}
          value={posStr === '' ? '' : Number(posStr)}
          placeholder="pos"
          hideControls
          onChange={(v) => setPosStr(v === '' ? '' : String(v))}
          title={`1-based ungapped position (1..${ungapped})`}
        />
        <span className="vp-from" title="Reference residue at this position">
          {from ?? '·'}
        </span>
        <span className="vp-arrow">→</span>
        <Select
          size="xs"
          className="vp-to"
          title="Alternate residue"
          data={[...RESIDUES.map((r) => ({ value: r, label: r })), { value: '-', label: '− (del)' }]}
          value={to}
          onChange={(v) => v && setTo(v)}
          allowDeselect={false}
        />
        <TextInput
          size="xs"
          className="vp-label"
          value={label}
          placeholder="label (optional)"
          onChange={(e) => setLabel(e.currentTarget.value)}
        />
        <Button size="compact-xs" disabled={!canAdd} onClick={addVariant} title="Add variant">
          Add
        </Button>
      </div>

      {/* Actions */}
      <div className="variant-actions">
        <Button
          size="compact-xs"
          variant="default"
          leftSection={<IconFileImport size={13} />}
          onClick={() => fileRef.current?.click()}
          title="Import CSV/TSV (seq,pos,from,to,label)"
        >
          Import
        </Button>
        <Button
          size="compact-xs"
          disabled={model.isBusy() || results.length === 0}
          loading={model.isBusy()}
          onClick={scoreAll}
          title="Score all variants with the selected source"
        >
          Score
        </Button>
        {model.isBusy() && (
          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => model.cancel()}>
            Cancel
          </Button>
        )}
        {results.length > 0 && (
          <Button size="compact-xs" variant="default" onClick={() => model.clear()} title="Remove all variants">
            Clear
          </Button>
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
        <Text fz="xs" c="red" mt="xs">
          {model.errorText()}
          {model.errorKindText() === 'blocked' && (
            <Text c="dimmed" fz="xs">The endpoint is unreachable — switch to the Local scorer to score offline.</Text>
          )}
        </Text>
      )}
      {importErrors.length > 0 && (
        <Text fz="xs" c="red" mt="xs">
          {importErrors.slice(0, 4).map((e, i) => (
            <div key={i}>{e}</div>
          ))}
          {importErrors.length > 4 && <div>…and {importErrors.length - 4} more</div>}
        </Text>
      )}

      {/* Results */}
      {results.length === 0 ? (
        <Text c="dimmed" fz="xs" mt="xs">
          Add a substitution above, import a CSV/TSV, or right-click a residue → “Add variant here”.
          {source?.needsNetwork ? ' Then press Score.' : ' It scores automatically.'}
        </Text>
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
                  <td className="vp-note">
                    {r.note ?? ''}
                    {(() => {
                      const mn = model.mutantNote(r.variant)
                      return mn ? <div className="vp-mut-note">🧬 {mn}</div> : null
                    })()}
                  </td>
                  <td className="vp-actions-cell">
                    {structure && model.canFold(r.variant) && r.visualRow >= 0 && (
                      <Button
                        size="compact-xs"
                        variant="default"
                        mr={4}
                        title="Fold the mutant & compare to wild-type in 3D (online)"
                        disabled={structBusy}
                        onClick={(e) => {
                          e.stopPropagation()
                          void model.foldMutant(r.variant)
                          onToast?.('Folding mutant — open the 3D panel to compare')
                        }}
                      >
                        {structBusy ? '…' : 'Fold 3D'}
                      </Button>
                    )}
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      className="vp-del"
                      title="Remove"
                      onClick={(e) => {
                        e.stopPropagation()
                        model.remove(r.key)
                      }}
                    >
                      <IconX size={14} />
                    </ActionIcon>
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

// Stable no-op store for when there's no structure controller to subscribe to.
const noopSub = () => () => {}
const zero = () => 0
